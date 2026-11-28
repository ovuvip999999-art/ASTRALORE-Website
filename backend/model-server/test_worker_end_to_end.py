import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from PIL import Image

from app import app
from worker_client import PrivateWorkerClient, WorkerClientConfig, WorkerClientError
from worker_runner import GenerationWorker

WORKER_TOKEN = "private-worker-end-to-end-token-32-characters-minimum"
USER_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
LEASE_ID = "33333333-3333-4333-8333-333333333333"
MODEL_ID = "astra-image-test"
REVISION = "a" * 40


class FakeQueueStore:
    def __init__(self):
        self.completed = []
        self.failed = []

    def claim_jobs(self, **kwargs):
        return [{
            "id": JOB_ID,
            "user_id": USER_ID,
            "modality": "image",
            "model_id": MODEL_ID,
            "request": {
                "model_revision": REVISION,
                "compiled_prompt": "A blue planet above the horizon",
                "width": 32,
                "height": 24,
            },
            "attempts": 1,
            "max_attempts": 3,
            "lease_token": LEASE_ID,
            "lease_expires_at": "2026-11-28T12:02:00+00:00",
            "cancel_requested": False,
        }]

    def heartbeat(self, **kwargs):
        return {
            "lease_expires_at": "2026-11-28T12:05:00+00:00",
            "cancel_requested": False,
        }

    def complete_job(self, **kwargs):
        self.completed.append(kwargs)
        return True

    def fail_job(self, **kwargs):
        self.failed.append(kwargs)
        return "failed"


class FakeAdapter:
    model_id = MODEL_ID
    revision = REVISION

    def generate(self, job, *, output_dir, cancel_event):
        output = Path(output_dir) / "result.png"
        Image.new("RGB", (32, 24), (20, 40, 80)).save(output, format="PNG")
        return output


class FakeAssetStore:
    def upload_validated_file(self, path, *, work_dir, user_id, job_id, validated_asset):
        result = dict(validated_asset)
        result["storage_path"] = f"{user_id}/{job_id}/{result['asset_id']}.png"
        return result

    def delete_object(self, object_path):
        raise AssertionError("The successful pipeline should not delete its output.")


class FakeSafetyGate:
    def check_prompt(self, prompt, modality):
        assert prompt and modality == "image"

    def check_output(self, media_path, modality):
        assert Path(media_path).is_file() and modality == "image"


class WorkerEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.api = TestClient(app)
        self.store = FakeQueueStore()
        self.env = patch.dict(os.environ, {
            "ASTRA_WORKER_API_ENABLED": "true",
            "ASTRA_WORKER_TOKEN": WORKER_TOKEN,
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.store_patch = patch("worker_api.create_store", return_value=self.store)
        self.store_patch.start()
        self.addCleanup(self.store_patch.stop)

    def transport(self):
        def handler(request):
            response = self.api.request(
                request.method,
                request.url.path,
                headers=dict(request.headers),
                content=request.content,
            )
            return httpx.Response(
                response.status_code,
                headers=dict(response.headers),
                content=response.content,
                request=request,
            )
        return httpx.MockTransport(handler)

    def test_worker_client_and_runner_complete_the_full_mocked_pipeline(self):
        client = PrivateWorkerClient(
            WorkerClientConfig("https://worker.internal.example", WORKER_TOKEN),
            transport=self.transport(),
        )
        with tempfile.TemporaryDirectory() as root:
            worker = GenerationWorker(
                client=client,
                asset_store=FakeAssetStore(),
                adapters={(MODEL_ID, REVISION): FakeAdapter()},
                safety_gate=FakeSafetyGate(),
                worker_id="end-to-end-worker",
                output_root=root,
                heartbeat_interval=1,
            )
            self.assertEqual(worker.run_once(), 1)

        self.assertEqual(len(self.store.completed), 1)
        output = self.store.completed[0]["output_asset"]
        self.assertEqual(output["mime_type"], "image/png")
        self.assertEqual(output["width"], 32)
        self.assertEqual(output["height"], 24)
        self.assertEqual(output["storage_path"], f"{USER_ID}/{JOB_ID}/{output['asset_id']}.png")
        self.assertEqual(self.store.failed, [])

    def test_private_worker_api_rejects_wrong_token_through_real_client(self):
        client = PrivateWorkerClient(
            WorkerClientConfig("https://worker.internal.example", "wrong-but-long-enough-worker-token-value-123456"),
            transport=self.transport(),
        )
        # The client itself enforces a strong token before it can make a request.
        with self.assertRaises(WorkerClientError):
            client.claim(worker_id="unauthorized-test")


if __name__ == "__main__":
    unittest.main()
