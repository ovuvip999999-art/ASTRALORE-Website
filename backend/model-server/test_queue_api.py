import os
import unittest
from unittest.mock import patch
from uuid import UUID

from fastapi.testclient import TestClient

from app import app
from queue_api import CreateJobRequest

USER_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
INTERNAL = "private-server-token-for-queue-tests-32chars"
USER_TOKEN = "user-access-token-for-queue-api-test-value-123456"


class FakeQueueStore:
    def __init__(self):
        self.enqueued = []
        self.lookup = None
        self.cancel_status = "cancelled"

    @staticmethod
    def _uuid(value, field):
        return str(UUID(value))

    def verify_user_access_token(self, token):
        if token != USER_TOKEN:
            raise ValueError("bad token")
        return USER_ID

    def enqueue_job(self, **kwargs):
        self.enqueued.append(kwargs)
        return {
            "id": JOB_ID,
            "status": "queued",
            "modality": kwargs["modality"],
            "model_id": kwargs["model_id"],
            "created_at": "2026-11-28T12:00:00+00:00",
        }

    def get_user_job(self, **kwargs):
        return self.lookup

    def cancel_user_job(self, **kwargs):
        return self.cancel_status


class FakeAssetStore:
    def __init__(self):
        self.paths = []

    def create_signed_url(self, path, *, expires_in):
        self.paths.append((path, expires_in))
        return "https://example.supabase.co/storage/v1/object/sign/astra-generated-private/" + path + "?token=short-lived"


CATALOG = [{
    "model_id": "astra-image-test",
    "revision": "sha256:immutable-test-revision",
    "provider": "local",
    "modalities": ["image"],
    "aspect_ratios": ["1:1"],
    "max_width": 1024,
    "max_height": 1024,
    "max_pixels": 1048576,
    "min_vram_mb": 8000,
    "enabled": True,
}]


class QueueApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.store = FakeQueueStore()
        self.asset_store = FakeAssetStore()
        self.env = patch.dict(os.environ, {
            "ASTRA_QUEUE_API_ENABLED": "true",
            "ASTRA_MODEL_RUNTIME_READY": "true",
            "ASTRA_MODERATION_READY": "true",
            "ASTRA_WORKER_API_ENABLED": "true",
            "ASTRA_WORKER_PROCESS_READY": "true",
            "ASTRA_CREATIVE_GENERATION_APPROVED": "true",
            "ASTRA_COST_POLICY_APPROVED": "true",
            "ASTRA_MODEL_SERVER_TOKEN": INTERNAL,
            "ASTRA_MODEL_CATALOG_JSON": __import__("json").dumps(CATALOG),
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.store_patch = patch("queue_api.create_store", return_value=self.store)
        self.store_patch.start()
        self.addCleanup(self.store_patch.stop)
        self.asset_patch = patch("queue_api.create_asset_store", return_value=self.asset_store)
        self.asset_patch.start()
        self.addCleanup(self.asset_patch.stop)

    def headers(self, *, internal=INTERNAL, user=USER_TOKEN):
        return {
            "X-ASTRA-Server-Token": internal,
            "Authorization": "Bearer " + user,
        }

    def body(self):
        return {
            "modality": "image",
            "model_id": "astra-image-test",
            "aspect_ratio": "1:1",
            "width": 512,
            "height": 512,
            "brief": {
                "prompt": "A quiet blue planet above a distant horizon",
                "modality": "image",
                "aspect_ratio": "1:1",
                "lighting": "soft sunrise",
            },
            "idempotency_key": "api-request-0001",
        }

    def test_video_job_duration_defaults_to_five_seconds_and_is_bounded(self):
        request = CreateJobRequest(
            modality="video",
            model_id="astra-video-test",
            aspect_ratio="16:9",
            width=832,
            height=480,
            brief={"prompt": "A cinematic sunrise", "modality": "video", "aspect_ratio": "16:9"},
            idempotency_key="video-request-001",
        )
        self.assertEqual(request.duration_seconds, 5)
        with self.assertRaises(Exception):
            CreateJobRequest(
                modality="video",
                model_id="astra-video-test",
                aspect_ratio="16:9",
                width=832,
                height=480,
                brief={"prompt": "A sunrise", "modality": "video", "aspect_ratio": "16:9"},
                idempotency_key="video-request-002",
                duration_seconds=121,
            )
        with self.assertRaises(Exception):
            CreateJobRequest(
                modality="image",
                model_id="astra-image-test",
                aspect_ratio="1:1",
                width=512,
                height=512,
                brief={"prompt": "A planet", "modality": "image", "aspect_ratio": "1:1"},
                idempotency_key="image-request-001",
                duration_seconds=5,
            )

    def test_queue_api_is_disabled_by_default(self):
        with patch.dict(os.environ, {"ASTRA_QUEUE_API_ENABLED": "false"}):
            response = self.client.post("/v1/jobs", json=self.body(), headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.store.enqueued, [])

    def test_create_requires_independent_server_readiness_and_owner_approvals(self):
        for flag in (
            "ASTRA_MODEL_RUNTIME_READY",
            "ASTRA_MODERATION_READY",
            "ASTRA_WORKER_API_ENABLED",
            "ASTRA_WORKER_PROCESS_READY",
            "ASTRA_CREATIVE_GENERATION_APPROVED",
            "ASTRA_COST_POLICY_APPROVED",
        ):
            with self.subTest(flag=flag), patch.dict(os.environ, {flag: "false"}):
                response = self.client.post("/v1/jobs", json=self.body(), headers=self.headers())
                self.assertEqual(response.status_code, 503)
                self.assertEqual(self.store.enqueued, [])

    def test_create_requires_private_server_secret(self):
        response = self.client.post("/v1/jobs", json=self.body(), headers=self.headers(internal="wrong"))
        self.assertEqual(response.status_code, 401)

    def test_create_requires_user_session(self):
        response = self.client.post(
            "/v1/jobs", json=self.body(),
            headers={"X-ASTRA-Server-Token": INTERNAL},
        )
        self.assertEqual(response.status_code, 401)

    def test_create_derives_owner_from_verified_user_and_compiles_brief(self):
        response = self.client.post("/v1/jobs", json=self.body(), headers=self.headers())
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["job_id"], JOB_ID)
        self.assertEqual(len(self.store.enqueued), 1)
        job = self.store.enqueued[0]
        self.assertEqual(job["user_id"], USER_ID)
        self.assertEqual(job["request"]["brief"]["prompt"], self.body()["brief"]["prompt"])
        self.assertIn("Lighting: soft sunrise", job["request"]["compiled_prompt"])
        self.assertEqual(job["request"]["model_revision"], CATALOG[0]["revision"])

    def test_create_rejects_brief_settings_mismatch(self):
        body = self.body()
        body["brief"]["modality"] = "video"
        response = self.client.post("/v1/jobs", json=body, headers=self.headers())
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.store.enqueued, [])

    def test_create_rejects_unknown_or_disabled_model(self):
        body = self.body()
        body["model_id"] = "unlisted-model"
        response = self.client.post("/v1/jobs", json=body, headers=self.headers())
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.store.enqueued, [])

    def test_create_rejects_arbitrary_owner_field(self):
        body = self.body()
        body["user_id"] = "99999999-9999-4999-8999-999999999999"
        response = self.client.post("/v1/jobs", json=body, headers=self.headers())
        self.assertEqual(response.status_code, 422)

    def test_status_is_owner_scoped_and_not_found_when_rls_hides_job(self):
        response = self.client.get("/v1/jobs/" + JOB_ID, headers=self.headers())
        self.assertEqual(response.status_code, 404)

    def test_status_returns_only_store_visible_job(self):
        self.store.lookup = {"id": JOB_ID, "status": "queued", "modality": "image"}
        response = self.client.get("/v1/jobs/" + JOB_ID, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], JOB_ID)

    def _completed_asset_job(self, storage_path=None):
        asset_id = "33333333-3333-4333-8333-333333333333"
        path = storage_path or f"{USER_ID}/{JOB_ID}/{asset_id}.png"
        return {
            "id": JOB_ID,
            "status": "succeeded",
            "output_asset": {
                "asset_id": asset_id,
                "sha256": "a" * 64,
                "mime_type": "image/png",
                "size_bytes": 1024,
                "width": 64,
                "height": 64,
                "storage_path": path,
            },
        }

    def test_asset_url_requires_owner_visible_completed_job(self):
        self.store.lookup = self._completed_asset_job()
        response = self.client.get("/v1/jobs/" + JOB_ID + "/asset-url", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["expires_in"], 60)
        self.assertEqual(self.asset_store.paths, [(self.store.lookup["output_asset"]["storage_path"], 60)])

    def test_asset_url_rejects_missing_incomplete_or_mismatched_owner_asset(self):
        self.store.lookup = None
        response = self.client.get("/v1/jobs/" + JOB_ID + "/asset-url", headers=self.headers())
        self.assertEqual(response.status_code, 404)

        self.store.lookup = {"id": JOB_ID, "status": "queued"}
        response = self.client.get("/v1/jobs/" + JOB_ID + "/asset-url", headers=self.headers())
        self.assertEqual(response.status_code, 409)

        self.store.lookup = self._completed_asset_job(
            storage_path=f"99999999-9999-4999-8999-999999999999/{JOB_ID}/33333333-3333-4333-8333-333333333333.png"
        )
        response = self.client.get("/v1/jobs/" + JOB_ID + "/asset-url", headers=self.headers())
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.asset_store.paths, [])

    def test_asset_url_signing_failure_is_sanitized(self):
        class BrokenAssetStore:
            def create_signed_url(self, path, *, expires_in):
                raise __import__("asset_store").AssetStoreError("internal credential detail")
        self.store.lookup = self._completed_asset_job()
        with patch("queue_api.create_asset_store", return_value=BrokenAssetStore()):
            response = self.client.get("/v1/jobs/" + JOB_ID + "/asset-url", headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("credential", response.text)

    def test_cancel_uses_verified_user_access_token(self):
        response = self.client.post("/v1/jobs/" + JOB_ID + "/cancel", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
