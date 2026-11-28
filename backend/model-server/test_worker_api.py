import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import app

WORKER_TOKEN = "private-astra-worker-token-value-32chars-minimum"
JOB_ID = "22222222-2222-4222-8222-222222222222"
LEASE_ID = "33333333-3333-4333-8333-333333333333"


class FakeWorkerStore:
    def __init__(self):
        self.claim_args = None
        self.heartbeat_result = {"lease_expires_at": "2026-11-28T12:05:00+00:00", "cancel_requested": False}
        self.complete_result = True
        self.fail_result = "queued"
        self.calls = []

    def claim_jobs(self, **kwargs):
        self.claim_args = kwargs
        return [{
            "id": JOB_ID,
            "user_id": "11111111-1111-4111-8111-111111111111",
            "modality": "image",
            "model_id": "astra-image-test",
            "request": {"compiled_prompt": "A blue planet"},
            "attempts": 1,
            "max_attempts": 3,
            "lease_token": LEASE_ID,
            "lease_expires_at": "2026-11-28T12:02:00+00:00",
            "cancel_requested": False,
        }]

    def heartbeat(self, **kwargs):
        self.calls.append(("heartbeat", kwargs))
        return self.heartbeat_result

    def complete_job(self, **kwargs):
        self.calls.append(("complete", kwargs))
        return self.complete_result

    def fail_job(self, **kwargs):
        self.calls.append(("fail", kwargs))
        return self.fail_result


class WorkerApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.store = FakeWorkerStore()
        self.env = patch.dict(os.environ, {
            "ASTRA_WORKER_API_ENABLED": "true",
            "ASTRA_INTERNAL_WORKER_TOKEN": WORKER_TOKEN,
            "ASTRA_PUBLIC_WORKER_TOKEN": "separate-public-worker-token-value-32chars-minimum",
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.store_patch = patch("worker_api.create_store", return_value=self.store)
        self.store_patch.start()
        self.addCleanup(self.store_patch.stop)

    def headers(self, token=WORKER_TOKEN):
        return {"X-ASTRA-Worker-Token": token}

    def lease_body(self):
        return {"job_id": JOB_ID, "lease_token": LEASE_ID, "lease_seconds": 90}

    def test_worker_api_is_disabled_by_default(self):
        with patch.dict(os.environ, {"ASTRA_WORKER_API_ENABLED": "false"}):
            response = self.client.post(
                "/internal/v1/worker/claim",
                json={"worker_id": "worker-test"},
                headers=self.headers(),
            )
        self.assertEqual(response.status_code, 503)
        self.assertIsNone(self.store.claim_args)

    def test_worker_token_must_be_strong_and_match(self):
        with patch.dict(os.environ, {"ASTRA_INTERNAL_WORKER_TOKEN": "weak"}):
            response = self.client.post(
                "/internal/v1/worker/claim",
                json={"worker_id": "worker-test"},
                headers=self.headers(),
            )
        self.assertEqual(response.status_code, 503)
        response = self.client.post(
            "/internal/v1/worker/claim",
            json={"worker_id": "worker-test"},
            headers=self.headers("wrong-worker-token"),
        )
        self.assertEqual(response.status_code, 401)

    def test_claim_uses_bounded_parameters_and_returns_worker_lease(self):
        response = self.client.post(
            "/internal/v1/worker/claim",
            json={"worker_id": "worker-test", "batch_size": 2, "lease_seconds": 90},
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.store.claim_args, {
            "worker_id": "worker-test", "request_origin": "internal", "batch_size": 2, "lease_seconds": 90,
        })
        job = response.json()["jobs"][0]
        self.assertEqual(job["id"], JOB_ID)
        self.assertEqual(job["lease_token"], LEASE_ID)
        self.assertNotIn("storage_path", job)

    def test_public_worker_identity_can_claim_only_public_origin(self):
        public_token = "separate-public-worker-token-value-32chars-minimum"
        response = self.client.post(
            "/internal/v1/worker/claim",
            json={"worker_id": "public-worker"},
            headers=self.headers(public_token),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.store.claim_args["request_origin"], "public")

    def test_equal_worker_tokens_fail_closed(self):
        with patch.dict(os.environ, {"ASTRA_PUBLIC_WORKER_TOKEN": WORKER_TOKEN}):
            response = self.client.post(
                "/internal/v1/worker/claim", json={"worker_id": "worker-test"}, headers=self.headers()
            )
        self.assertEqual(response.status_code, 503)
        self.assertIsNone(self.store.claim_args)

    def test_claim_rejects_unbounded_or_extra_fields(self):
        response = self.client.post(
            "/internal/v1/worker/claim",
            json={"worker_id": "worker-test", "batch_size": 5},
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 422)
        response = self.client.post(
            "/internal/v1/worker/claim",
            json={"worker_id": "worker-test", "user_id": "attacker"},
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 422)

    def test_heartbeat_renews_lease_and_reports_cancel_flag(self):
        response = self.client.post(
            "/internal/v1/worker/heartbeat",
            json=self.lease_body(),
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["cancel_requested"])
        self.assertEqual(self.store.calls[0][0], "heartbeat")

    def test_heartbeat_rejects_lost_lease_and_malformed_uuid(self):
        self.store.heartbeat_result = None
        response = self.client.post(
            "/internal/v1/worker/heartbeat",
            json=self.lease_body(),
            headers=self.headers(),
        )
        self.assertEqual(response.status_code, 409)
        body = self.lease_body()
        body["job_id"] = "not-a-uuid-000000000000000000000000"
        response = self.client.post(
            "/internal/v1/worker/heartbeat", json=body, headers=self.headers()
        )
        self.assertEqual(response.status_code, 422)

    def test_completion_requires_current_lease(self):
        body = {
            "job_id": JOB_ID,
            "lease_token": LEASE_ID,
            "output_asset": {
                "asset_id": "44444444-4444-4444-8444-444444444444",
                "sha256": "a" * 64,
                "mime_type": "image/png",
                "size_bytes": 1024,
                "width": 64,
                "height": 64,
                "storage_path": f"11111111-1111-4111-8111-111111111111/{JOB_ID}/44444444-4444-4444-8444-444444444444.png",
            },
        }
        response = self.client.post(
            "/internal/v1/worker/complete", json=body, headers=self.headers()
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "succeeded")
        self.store.complete_result = False
        response = self.client.post(
            "/internal/v1/worker/complete", json=body, headers=self.headers()
        )
        self.assertEqual(response.status_code, 409)

    def test_failure_accepts_only_safe_error_codes(self):
        body = {"job_id": JOB_ID, "lease_token": LEASE_ID, "error_code": "MODEL_TIMEOUT", "retryable": True}
        response = self.client.post(
            "/internal/v1/worker/fail", json=body, headers=self.headers()
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "queued")
        body["error_code"] = "raw stack trace / secret"
        response = self.client.post(
            "/internal/v1/worker/fail", json=body, headers=self.headers()
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
