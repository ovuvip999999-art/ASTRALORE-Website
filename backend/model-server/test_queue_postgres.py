import json
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


DSN = os.environ.get("ASTRA_TEST_DATABASE_URL")
USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
ASSET_ID = "33333333-3333-4333-8333-333333333333"
MIGRATIONS = [
    Path(__file__).resolve().parents[1] / "migrations" / "0010_astra_generation_jobs.sql",
    Path(__file__).resolve().parents[1] / "migrations" / "0011_astra_private_generated_assets.sql",
]"


@unittest.skipUnless(DSN, "ASTRA_TEST_DATABASE_URL is not configured; PostgreSQL integration tests run in CI.")
class QueuePostgresIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with psycopg.connect(DSN, autocommit=True) as conn:
            conn.execute("""
                do $$ begin
                  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
                  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
                  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
                end $$;
                create schema if not exists auth;
                create schema if not exists storage;
                create table if not exists storage.buckets (
                  id text primary key,
                  name text not null,
                  public boolean not null default false,
                  file_size_limit bigint,
                  allowed_mime_types text[]
                );
                create table if not exists storage.objects (
                  id uuid primary key default gen_random_uuid(),
                  bucket_id text not null,
                  name text not null
                );
                alter table storage.objects enable row level security;
                create table if not exists auth.users (
                  id uuid primary key,
                  email text unique
                );
                create or replace function auth.uid()
                returns uuid language sql stable
                as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
                grant usage on schema auth to authenticated, service_role;
                grant execute on function auth.uid() to authenticated, service_role;
                grant usage on schema public to anon, authenticated, service_role;
                drop table if exists public.astra_generation_jobs cascade;
                drop policy if exists "ASTRA generated assets remain server private" on storage.objects;
                delete from storage.buckets where id = 'astra-generated-private';
            """)
            for migration in MIGRATIONS:
                conn.execute(migration.read_text(encoding="utf-8"))
            conn.execute(
                "insert into auth.users (id, email) values (%s, %s), (%s, %s) on conflict (id) do nothing",
                (USER_A, "queue-a@example.invalid", USER_B, "queue-b@example.invalid"),
            )

    def setUp(self):
        with psycopg.connect(DSN, autocommit=True) as conn:
            conn.execute("delete from public.astra_generation_jobs")

    def connect(self, role=None, user_id=None):
        conn = psycopg.connect(DSN, autocommit=True, row_factory=dict_row)
        if role:
            conn.execute("set role " + role)
        if user_id:
            conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (user_id,))
        return conn

    def enqueue(self, conn, *, user_id=USER_A, key="request-key-0001", modality="image", request=None):
        payload = request if request is not None else {"prompt": "A calm blue planet"}
        row = conn.execute(
            """select * from public.astra_enqueue_generation_job(%s, %s, %s, %s, %s)""",
            (user_id, modality, "astra-" + modality + "-test", Jsonb(payload), key),
        ).fetchone()
        return row

    def claim(self, conn, worker="integration-worker"):
        return conn.execute(
            "select * from public.astra_claim_generation_jobs(%s, 1, 90)",
            (worker,),
        ).fetchone()

    def test_idempotency_returns_same_job_and_rejects_different_payload(self):
        with self.connect("service_role") as conn:
            first = self.enqueue(conn)
            second = self.enqueue(conn)
            self.assertEqual(first["id"], second["id"])
            with self.assertRaises(psycopg.Error):
                self.enqueue(conn, request={"prompt": "Different prompt"})

    def test_active_queue_limits_and_idempotent_retry(self):
        with self.connect("service_role") as conn:
            first = self.enqueue(conn, key="request-key-0001")
            self.enqueue(conn, key="request-key-0002")
            self.assertEqual(self.enqueue(conn, key="request-key-0001")["id"], first["id"])
            with self.assertRaises(psycopg.Error):
                self.enqueue(conn, key="request-key-0003")

    def test_claim_lease_heartbeat_and_expired_lease_recovery(self):
        with self.connect("service_role") as conn:
            created = self.enqueue(conn)
            claimed = self.claim(conn)
            self.assertEqual(claimed["id"], created["id"])
            self.assertEqual(claimed["status"], "running")
            self.assertEqual(claimed["attempts"], 1)
            heartbeat = conn.execute(
                "select * from public.astra_heartbeat_generation_job(%s, %s, 90)",
                (claimed["id"], claimed["lease_token"]),
            ).fetchone()
            self.assertFalse(heartbeat["cancel_requested"])
            conn.execute(
                "update public.astra_generation_jobs set lease_expires_at = now() - interval '1 second' where id = %s",
                (claimed["id"],),
            )
            self.assertIsNone(self.claim(conn))
            recovered = conn.execute(
                "select status, attempts from public.astra_generation_jobs where id = %s",
                (claimed["id"],),
            ).fetchone()
            self.assertEqual(recovered["status"], "queued")
            self.assertEqual(recovered["attempts"], 1)
            conn.execute(
                "update public.astra_generation_jobs set available_at = now() where id = %s",
                (claimed["id"],),
            )
            reclaimed = self.claim(conn)
            self.assertEqual(reclaimed["id"], created["id"])
            self.assertEqual(reclaimed["attempts"], 2)
            self.assertNotEqual(reclaimed["lease_token"], claimed["lease_token"])

    def test_successful_completion_checks_metadata_and_terminal_state(self):
        with self.connect("service_role") as conn:
            self.enqueue(conn)
            claimed = self.claim(conn)
            asset = {
                "asset_id": ASSET_ID, "sha256": "a" * 64, "mime_type": "image/png",
                "size_bytes": 2048, "width": 512, "height": 512,
                "storage_path": f"{USER_A}/{claimed['id']}/{ASSET_ID}.png",
            }
            result = conn.execute(
                "select public.astra_complete_generation_job(%s, %s, %s) as completed",
                (claimed["id"], claimed["lease_token"], Jsonb(asset)),
            ).fetchone()
            self.assertTrue(result["completed"])
            job = conn.execute("select * from public.astra_generation_jobs where id = %s", (claimed["id"],)).fetchone()
            self.assertEqual(job["status"], "succeeded")
            self.assertEqual(job["output_asset"]["storage_path"], f"{USER_A}/{claimed['id']}/{ASSET_ID}.png")
            self.assertIsNotNone(job["completed_at"])
            self.assertFalse(conn.execute(
                "select public.astra_complete_generation_job(%s, %s, %s) as completed",
                (claimed["id"], claimed["lease_token"], Jsonb(asset)),
            ).fetchone()["completed"])

    def test_invalid_video_duration_is_rejected(self):
        with self.connect("service_role") as conn:
            self.enqueue(conn, modality="video")
            claimed = self.claim(conn)
            asset = {
                "asset_id": ASSET_ID, "sha256": "b" * 64, "mime_type": "video/mp4",
                "size_bytes": 2048, "width": 640, "height": 360, "duration_ms": 120001,
                "storage_path": f"{USER_A}/{claimed['id']}/{ASSET_ID}.mp4",
            }
            with self.assertRaises(psycopg.Error):
                conn.execute(
                    "select public.astra_complete_generation_job(%s, %s, %s)",
                    (claimed["id"], claimed["lease_token"], Jsonb(asset)),
                )

    def test_completion_rejects_storage_path_for_another_owner_or_job(self):
        with self.connect("service_role") as conn:
            self.enqueue(conn)
            claimed = self.claim(conn)
            asset = {
                "asset_id": ASSET_ID, "sha256": "a" * 64, "mime_type": "image/png",
                "size_bytes": 2048, "width": 512, "height": 512,
                "storage_path": f"{USER_B}/{claimed['id']}/{ASSET_ID}.png",
            }
            with self.assertRaises(psycopg.Error):
                conn.execute(
                    "select public.astra_complete_generation_job(%s, %s, %s)",
                    (claimed["id"], claimed["lease_token"], Jsonb(asset)),
                )

    def test_retryable_failure_requeues_and_final_failure_terminates(self):
        with self.connect("service_role") as conn:
            self.enqueue(conn)
            first = self.claim(conn)
            status = conn.execute(
                "select public.astra_fail_generation_job(%s, %s, %s, true) as status",
                (first["id"], first["lease_token"], "MODEL_TIMEOUT"),
            ).fetchone()["status"]
            self.assertEqual(status, "queued")
            conn.execute("update public.astra_generation_jobs set available_at = now()")
            second = self.claim(conn)
            status = conn.execute(
                "select public.astra_fail_generation_job(%s, %s, %s, false) as status",
                (second["id"], second["lease_token"], "MODEL_FAILED"),
            ).fetchone()["status"]
            self.assertEqual(status, "failed")

    def test_rls_and_user_cancellation_are_owner_scoped(self):
        with self.connect("service_role") as conn:
            own = self.enqueue(conn, user_id=USER_A, key="request-key-a001")
            other = self.enqueue(conn, user_id=USER_B, key="request-key-b001")

        with self.connect("authenticated", USER_A) as conn:
            rows = conn.execute("select id from public.astra_generation_jobs").fetchall()
            self.assertEqual([row["id"] for row in rows], [own["id"]])
            with self.assertRaises(psycopg.Error):
                conn.execute("select public.astra_cancel_generation_job(%s)", (other["id"],))
            result = conn.execute(
                "select public.astra_cancel_generation_job(%s) as status", (own["id"],)
            ).fetchone()["status"]
            self.assertEqual(result, "cancelled")

    def test_running_cancel_is_cooperative(self):
        with self.connect("service_role") as conn:
            self.enqueue(conn)
            claimed = self.claim(conn)
        with self.connect("authenticated", USER_A) as conn:
            result = conn.execute(
                "select public.astra_cancel_generation_job(%s) as status", (claimed["id"],)
            ).fetchone()["status"]
            self.assertEqual(result, "cancellation_requested")
        with self.connect("service_role") as conn:
            heartbeat = conn.execute(
                "select * from public.astra_heartbeat_generation_job(%s, %s, 90)",
                (claimed["id"], claimed["lease_token"]),
            ).fetchone()
            self.assertTrue(heartbeat["cancel_requested"])
            status = conn.execute(
                "select public.astra_fail_generation_job(%s, %s, %s, false) as status",
                (claimed["id"], claimed["lease_token"], "CANCELLED_BY_USER"),
            ).fetchone()["status"]
            self.assertEqual(status, "cancelled")

    def test_two_workers_claim_distinct_jobs_concurrently(self):
        with self.connect("service_role") as conn:
            self.enqueue(conn, key="request-key-0001")
            self.enqueue(conn, key="request-key-0002")

        def claim_for(worker):
            with self.connect("service_role") as conn:
                row = self.claim(conn, worker)
                return row["id"] if row else None

        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(claim_for, ["worker-one", "worker-two"]))
        self.assertEqual(len(set(ids)), 2)
        self.assertTrue(all(isinstance(value, UUID) for value in ids))


if __name__ == "__main__":
    unittest.main()
