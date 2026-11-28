import json
import unittest

import httpx

from worker_client import (
    PrivateWorkerClient,
    WorkerClientConfig,
    WorkerClientError,
)

TOKEN = "private-worker-client-token-value-with-32chars"
JOB_ID = "22222222-2222-4222-8222-222222222222"
LEASE_ID = "33333333-3333-4333-8333-333333333333"


class WorkerClientTests(unittest.TestCase):
    def config(self):
        return WorkerClientConfig("https://worker.internal.example", TOKEN)

    def test_config_requires_https_and_long_token(self):
        with self.assertRaises(WorkerClientError):
            WorkerClientConfig.from_env({
                "ASTRA_WORKER_API_URL": "http://public.example",
                "ASTRA_WORKER_TOKEN": TOKEN,
            })
        with self.assertRaises(WorkerClientError):
            WorkerClientConfig.from_env({
                "ASTRA_WORKER_API_URL": "https://worker.example",
                "ASTRA_WORKER_TOKEN": "short",
            })

    def test_claim_sends_worker_token_and_validates_job(self):
        def handler(request):
            self.assertEqual(request.url.path, "/internal/v1/worker/claim")
            self.assertEqual(request.headers["x-astra-worker-token"], TOKEN)
            body = json.loads(request.content)
            self.assertEqual(body["worker_id"], "worker-one")
            self.assertEqual(body["batch_size"], 2)
            return httpx.Response(200, json={"jobs": [{
                "id": JOB_ID,
                "lease_token": LEASE_ID,
                "modality": "image",
                "request": {"compiled_prompt": "A blue planet"},
            }]})
        client = PrivateWorkerClient(self.config(), transport=httpx.MockTransport(handler))
        jobs = client.claim(worker_id="worker-one", batch_size=2)
        self.assertEqual(jobs[0]["id"], JOB_ID)

    def test_claim_rejects_invalid_parameters_and_malformed_response(self):
        client = PrivateWorkerClient(
            self.config(),
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"jobs": [{"id": "bad"}]})),
        )
        with self.assertRaises(WorkerClientError):
            client.claim(worker_id="worker", batch_size=5)
        with self.assertRaises(WorkerClientError):
            client.claim(worker_id="worker")

    def test_heartbeat_reports_cancellation(self):
        def handler(request):
            self.assertEqual(request.url.path, "/internal/v1/worker/heartbeat")
            return httpx.Response(200, json={
                "job_id": JOB_ID,
                "lease_expires_at": "2026-11-28T12:05:00Z",
                "cancel_requested": True,
            })
        client = PrivateWorkerClient(self.config(), transport=httpx.MockTransport(handler))
        result = client.heartbeat(job_id=JOB_ID, lease_token=LEASE_ID)
        self.assertTrue(result["cancel_requested"])

    def test_complete_and_fail_use_lease_scoped_routes(self):
        calls = []
        def handler(request):
            calls.append(request.url.path)
            if request.url.path.endswith("/complete"):
                return httpx.Response(200, json={"job_id": JOB_ID, "status": "succeeded"})
            return httpx.Response(200, json={"job_id": JOB_ID, "status": "queued"})
        client = PrivateWorkerClient(self.config(), transport=httpx.MockTransport(handler))
        self.assertTrue(client.complete(
            job_id=JOB_ID, lease_token=LEASE_ID,
            output_asset={"asset_id": "44444444-4444-4444-8444-444444444444"},
        ))
        self.assertEqual(client.fail(
            job_id=JOB_ID, lease_token=LEASE_ID, error_code="MODEL_TIMEOUT", retryable=True
        ), "queued")
        self.assertEqual(calls, [
            "/internal/v1/worker/complete",
            "/internal/v1/worker/fail",
        ])

    def test_http_errors_are_sanitized_and_do_not_leak_response_body(self):
        client = PrivateWorkerClient(
            self.config(),
            transport=httpx.MockTransport(lambda request: httpx.Response(500, text="secret-token-value")),
        )
        with self.assertRaises(WorkerClientError) as raised:
            client.claim(worker_id="worker")
        self.assertNotIn("secret-token-value", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
