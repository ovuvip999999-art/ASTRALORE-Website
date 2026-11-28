from pathlib import Path
import unittest


MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "0010_astra_generation_jobs.sql"


class QueueMigrationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()
        cls.storage_sql = (MIGRATION.parent / "0011_astra_private_generated_assets.sql").read_text(encoding="utf-8").lower()
        cls.access_sql = (MIGRATION.parent / "0012_astra_job_access_modes.sql").read_text(encoding="utf-8").lower()
        cls.worker_claim_sql = (MIGRATION.parent / "0013_astra_origin_scoped_worker_claims.sql").read_text(encoding="utf-8").lower()
        cls.capacity_sql = (MIGRATION.parent / "0014_astra_worker_capacity_fairness.sql").read_text(encoding="utf-8").lower()

    def test_private_table_has_owner_scoped_rls(self):
        self.assertIn("alter table public.astra_generation_jobs enable row level security", self.sql)
        self.assertIn("auth.uid() = user_id", self.sql)
        self.assertIn("grant select on public.astra_generation_jobs to authenticated", self.sql)
        self.assertIn("revoke all on public.astra_generation_jobs from anon, authenticated", self.sql)

    def test_worker_rpcs_are_service_role_only(self):
        for function in (
            "astra_enqueue_generation_job",
            "astra_claim_generation_jobs",
            "astra_heartbeat_generation_job",
            "astra_complete_generation_job",
            "astra_fail_generation_job",
        ):
            self.assertIn("function public." + function, self.sql)
            self.assertIn("to service_role", self.sql)
        self.assertIn("from public, anon, authenticated", self.sql)

    def test_claim_uses_atomic_skip_locked(self):
        self.assertIn("for update skip locked", self.sql)
        self.assertIn("lease_expires_at", self.sql)
        self.assertIn("lease_token", self.sql)

    def test_queue_admission_is_bounded_and_idempotent(self):
        self.assertIn(">= 2", self.sql)
        self.assertIn(">= 100", self.sql)
        self.assertIn("unique (user_id, idempotency_key)", self.sql)
        self.assertIn("idempotency key was already used for a different request", self.sql)

    def test_user_cancel_is_authenticated_and_owner_scoped(self):
        self.assertIn("function public.astra_cancel_generation_job", self.sql)
        self.assertIn("if auth.uid() is null", self.sql)
        self.assertIn("user_id = auth.uid()", self.sql)
        self.assertIn("to authenticated", self.sql)

    def test_output_metadata_has_size_and_dimension_bounds(self):
        self.assertIn("536870912", self.sql)
        self.assertIn("16384", self.sql)
        self.assertIn("100000000", self.sql)
        self.assertIn("120000", self.sql)
        self.assertIn("'storage_path'", self.sql)
        self.assertIn("v_job.user_id::text", self.sql)
        self.assertIn("p_job_id::text", self.sql)

    def test_job_access_modes_are_explicit_and_server_only(self):
        self.assertIn("add column if not exists request_origin", self.access_sql)
        self.assertIn("request_origin in ('internal', 'public')", self.access_sql)
        self.assertIn("astra_enqueue_generation_job_v2", self.access_sql)
        self.assertIn("p_request_origin text", self.access_sql)
        self.assertIn("v_job.request_origin <> p_request_origin", self.access_sql)
        self.assertIn("p_request_origin = 'public' then 1 else 2", self.access_sql)
        self.assertIn("from public, anon, authenticated", self.access_sql)
        self.assertIn("to service_role", self.access_sql)

    def test_worker_claim_rpc_is_origin_scoped_and_replaces_global_claim(self):
        self.assertIn("astra_claim_generation_jobs_v2", self.worker_claim_sql)
        self.assertIn("p_request_origin text", self.worker_claim_sql)
        self.assertIn("request_origin = p_request_origin", self.worker_claim_sql)
        self.assertIn("from public, anon, authenticated", self.worker_claim_sql)
        self.assertIn("to service_role", self.worker_claim_sql)
        self.assertIn("drop function if exists public.astra_claim_generation_jobs", self.worker_claim_sql)

    def test_worker_capacity_has_reserved_internal_slots_and_atomic_accounting(self):
        self.assertIn("astra_worker_capacity", self.capacity_sql)
        self.assertIn("global_slots integer not null default 4", self.capacity_sql)
        self.assertIn("public_slots integer not null default 2", self.capacity_sql)
        self.assertIn("public_slots < global_slots", self.capacity_sql)
        self.assertIn("pg_advisory_xact_lock(0, 10011)", self.capacity_sql)
        self.assertIn("v_public_slots - v_running_public", self.capacity_sql)
        self.assertIn("v_global_slots - v_running_total", self.capacity_sql)
        self.assertIn("for update skip locked", self.capacity_sql)
        self.assertIn("to service_role", self.capacity_sql)

    def test_generated_asset_bucket_is_private_and_user_policies_are_restricted(self):
        self.assertIn("'astra-generated-private'", self.storage_sql)
        self.assertIn("public = false", self.storage_sql)
        self.assertIn("536870912", self.storage_sql)
        self.assertIn("as restrictive", self.storage_sql)
        self.assertIn("to anon, authenticated", self.storage_sql)
        self.assertIn("bucket_id <> 'astra-generated-private'", self.storage_sql)


if __name__ == "__main__":
    unittest.main()
