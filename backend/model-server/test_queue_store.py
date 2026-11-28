import json
import unittest

import httpx

from queue_store import QueueStoreError, SupabaseQueueConfig, SupabaseQueueStore

USER_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
LEASE_ID = "33333333-3333-4333-8333-333333333333"
ANON = "anon-key-value-with-sufficient-length-123456"
SERVICE = "service-role-key-value-with-sufficient-length-123456"
USER_TOKEN = "user-access-token-value-with-sufficient-length-123456"


class QueueStoreTests(unittest.TestCase):
    def config(self):
        return SupabaseQueueConfig(
            url="https://example.supabase.co",
            anon_key=ANON,
            service_role_key=SERVICE,
        )

    def store(self, handler):
        transport = httpx.MockTransport(handler)
        return SupabaseQueueStore(self.config(), transport=transport)

    def test_config_requires_https_and_both_server_keys(self):
        with self.assertRaises(QueueStoreError):
            SupabaseQueueConfig.from_env({
                "SUPABASE_URL": "http://example.com",
                "SUPABASE_ANON_KEY": ANON,
                "SUPABASE_SERVICE_ROLE_KEY": SERVICE,
            })
        with self.assertRaises(QueueStoreError):
            SupabaseQueueConfig.from_env({
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_ANON_KEY": ANON,
            })

    def test_user_token_is_verified_using_anon_key_and_user_bearer(self):
        def handler(request):
            self.assertEqual(request.url.path, "/auth/v1/user")
            self.assertEqual(request.headers["apikey"], ANON)
            self.assertEqual(request.headers["authorization"], "Bearer " + USER_TOKEN)
            return httpx.Response(200, json={"id": USER_ID})
        self.assertEqual(self.store(handler).verify_user_access_token(USER_TOKEN), USER_ID)

    def test_enqueue_uses_service_role_only_on_server_rpc(self):
        def handler(request):
            self.assertEqual(request.url.path, "/rest/v1/rpc/astra_enqueue_generation_job_v2")
            self.assertEqual(request.headers["apikey"], SERVICE)
            self.assertEqual(request.headers["authorization"], "Bearer " + SERVICE)
            body = json.loads(request.content)
            self.assertEqual(body["p_user_id"], USER_ID)
            self.assertEqual(body["p_request_origin"], "internal")
            return httpx.Response(200, json={"id": JOB_ID, "status": "queued"})
        result = self.store(handler).enqueue_job(
            user_id=USER_ID, modality="image", model_id="astra-image-v1",
            request={"prompt": "A calm blue planet"}, idempotency_key="request-1234",
        )
        self.assertEqual(result["id"], JOB_ID)

    def test_enqueue_rejects_unknown_origin_before_network(self):
        store = self.store(lambda request: self.fail("Network must not be called"))
        with self.assertRaises(QueueStoreError):
            store.enqueue_job(
                user_id=USER_ID, modality="image", model_id="astra-image-v1",
                request={"prompt": "test"}, idempotency_key="request-1234",
                request_origin="admin",
            )

    def test_claim_rejects_unknown_origin_before_network(self):
        store = self.store(lambda request: self.fail("Network must not be called"))
        with self.assertRaises(QueueStoreError):
            store.claim_jobs(worker_id="worker", request_origin="all")

    def test_claim_uses_bounded_batch_and_lease(self):
        def handler(request):
            body = json.loads(request.content)
            self.assertEqual(body["p_request_origin"], "public")
            self.assertEqual(body["p_batch_size"], 2)
            self.assertEqual(body["p_lease_seconds"], 90)
            return httpx.Response(200, json=[{"id": JOB_ID, "status": "running"}])
        self.assertEqual(len(self.store(handler).claim_jobs(worker_id="test-worker", request_origin="public", batch_size=2, lease_seconds=90)), 1)

    def test_heartbeat_returns_cancellation_state(self):
        def handler(request):
            return httpx.Response(200, json=[{"cancel_requested": True, "lease_expires_at": "2026-11-28T10:00:00Z"}])
        result = self.store(handler).heartbeat(job_id=JOB_ID, lease_token=LEASE_ID)
        self.assertTrue(result["cancel_requested"])

    def test_complete_requires_boolean_rpc_result(self):
        def handler(request):
            return httpx.Response(200, json=True)
        asset = {
            "asset_id": JOB_ID, "sha256": "a" * 64, "mime_type": "image/png",
            "size_bytes": 2048, "width": 512, "height": 512,
        }
        self.assertTrue(self.store(handler).complete_job(job_id=JOB_ID, lease_token=LEASE_ID, output_asset=asset))

    def test_fail_accepts_only_known_transition_results(self):
        def handler(request):
            return httpx.Response(200, json="queued")
        self.assertEqual(self.store(handler).fail_job(
            job_id=JOB_ID, lease_token=LEASE_ID, error_code="MODEL_TIMEOUT", retryable=True
        ), "queued")

    def test_user_job_lookup_uses_user_token_and_rls_endpoint(self):
        def handler(request):
            self.assertEqual(request.url.path, "/rest/v1/astra_generation_jobs")
            self.assertEqual(request.headers["apikey"], ANON)
            self.assertEqual(request.headers["authorization"], "Bearer " + USER_TOKEN)
            return httpx.Response(200, json=[{"id": JOB_ID, "status": "queued"}])
        self.assertEqual(self.store(handler).get_user_job(job_id=JOB_ID, access_token=USER_TOKEN)["id"], JOB_ID)

    def test_cancel_uses_user_token_not_service_role(self):
        def handler(request):
            self.assertEqual(request.url.path, "/rest/v1/rpc/astra_cancel_generation_job")
            self.assertEqual(request.headers["apikey"], ANON)
            self.assertEqual(request.headers["authorization"], "Bearer " + USER_TOKEN)
            return httpx.Response(200, json="cancellation_requested")
        self.assertEqual(self.store(handler).cancel_user_job(job_id=JOB_ID, access_token=USER_TOKEN), "cancellation_requested")

    def test_invalid_ids_and_unbounded_claims_are_rejected_before_network(self):
        store = self.store(lambda request: self.fail("Network must not be called"))
        with self.assertRaises(QueueStoreError):
            store.enqueue_job(
                user_id="not-a-uuid", modality="image", model_id="x",
                request={}, idempotency_key="request-1234",
            )
        with self.assertRaises(QueueStoreError):
            store.claim_jobs(worker_id="worker", batch_size=5)
        with self.assertRaises(QueueStoreError):
            store.heartbeat(job_id=JOB_ID, lease_token="bad")

    def test_http_error_does_not_leak_server_response_body(self):
        def handler(request):
            return httpx.Response(500, text="service_role_secret_should_not_escape")
        with self.assertRaises(QueueStoreError) as raised:
            self.store(handler).claim_jobs(worker_id="worker")
        self.assertNotIn("service_role_secret", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
