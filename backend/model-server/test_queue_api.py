import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import app

USER_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
INTERNAL = "private-server-token-for-queue-tests-32chars"
USER_TOKEN = "user-access-token-for-queue-api-test-value-123456"


class FakeQueueStore:
    def __init__(self):
        self.enqueued = []
        self.lookup = None
        self.cancel_status = "cancelled"

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
        self.env = patch.dict(os.environ, {
            "ASTRA_QUEUE_API_ENABLED": "true",
            "ASTRA_MODEL_SERVER_TOKEN": INTERNAL,
            "ASTRA_MODEL_CATALOG_JSON": __import__("json").dumps(CATALOG),
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.store_patch = patch("queue_api.create_store", return_value=self.store)
        self.store_patch.start()
        self.addCleanup(self.store_patch.stop)

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

    def test_queue_api_is_disabled_by_default(self):
        with patch.dict(os.environ, {"ASTRA_QUEUE_API_ENABLED": "false"}):
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

    def test_cancel_uses_verified_user_access_token(self):
        response = self.client.post("/v1/jobs/" + JOB_ID + "/cancel", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
