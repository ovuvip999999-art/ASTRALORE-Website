import tempfile
import unittest
from pathlib import Path
from threading import Event

from PIL import Image

from worker_client import WorkerLeaseLost
from worker_runner import GenerationError, GenerationWorker

USER_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
LEASE_ID = "33333333-3333-4333-8333-333333333333"
MODEL_ID = "astra-image-test"
REVISION = "sha256:immutable-test-revision"


def make_job():
    return {
        "id": JOB_ID,
        "user_id": USER_ID,
        "modality": "image",
        "model_id": MODEL_ID,
        "request": {
            "model_revision": REVISION,
            "compiled_prompt": "A calm blue planet",
            "width": 32,
            "height": 24,
        },
        "lease_token": LEASE_ID,
        "cancel_requested": False,
    }


class FakeClient:
    def __init__(self, jobs=None):
        self.jobs = [make_job()] if jobs is None else jobs
        self.claim_calls = 0
        self.failures = []
        self.completed = []
        self.heartbeat_result = {"cancel_requested": False}
        self.complete_error = None

    def claim(self, **kwargs):
        self.claim_calls += 1
        return self.jobs

    def heartbeat(self, **kwargs):
        return self.heartbeat_result

    def fail(self, **kwargs):
        self.failures.append(kwargs)
        return "failed"

    def complete(self, **kwargs):
        if self.complete_error:
            raise self.complete_error
        self.completed.append(kwargs)
        return True


class FakeAssetStore:
    def __init__(self):
        self.uploads = []
        self.deleted = []

    def upload_validated_file(self, path, *, work_dir, user_id, job_id, validated_asset):
        self.uploads.append((Path(path), user_id, job_id, validated_asset))
        result = dict(validated_asset)
        result["storage_path"] = f"{user_id}/{job_id}/{validated_asset['asset_id']}.png"
        return result

    def delete_object(self, object_path):
        self.deleted.append(object_path)


class FakeSafetyGate:
    def __init__(self, *, block_prompt=False, block_output=False, unavailable=False):
        self.block_prompt = block_prompt
        self.block_output = block_output
        self.unavailable = unavailable
        self.prompt_checks = 0
        self.output_checks = 0

    def check_prompt(self, prompt, modality):
        self.prompt_checks += 1
        if self.unavailable:
            from safety_gate import SafetyGateError
            raise SafetyGateError("MODERATION_UNAVAILABLE", retryable=True)
        if self.block_prompt:
            from safety_gate import SafetyGateError
            raise SafetyGateError("SAFETY_REVIEW_REQUIRED", retryable=False)

    def check_output(self, media_path, modality):
        self.output_checks += 1
        if self.unavailable:
            from safety_gate import SafetyGateError
            raise SafetyGateError("MODERATION_UNAVAILABLE", retryable=True)
        if self.block_output:
            from safety_gate import SafetyGateError
            raise SafetyGateError("SAFETY_REVIEW_REQUIRED", retryable=False)


class PngAdapter:
    def __init__(self, *, dimensions=(32, 24), cancel=False, error=None):
        self.dimensions = dimensions
        self.cancel = cancel
        self.error = error

    def generate(self, job, *, output_dir, cancel_event):
        if self.error:
            raise self.error
        path = output_dir / "generated.png"
        Image.new("RGB", self.dimensions, (10, 30, 60)).save(path, format="PNG")
        if self.cancel:
            cancel_event.set()
        return path


class WorkerRunnerTests(unittest.TestCase):
    def build_worker(self, root, *, adapter=None, client=None, asset_store=None, safety_gate=True):
        client = client or FakeClient()
        asset_store = asset_store or FakeAssetStore()
        adapters = {(MODEL_ID, REVISION): adapter} if adapter else {}
        gate = FakeSafetyGate() if safety_gate is True else safety_gate
        worker = GenerationWorker(
            client=client,
            asset_store=asset_store,
            adapters=adapters,
            safety_gate=gate,
            worker_id="test-worker",
            output_root=root,
            heartbeat_interval=1,
        )
        return worker, client, asset_store

    def test_worker_does_not_claim_any_jobs_without_reviewed_model_adapter(self):
        with tempfile.TemporaryDirectory() as root:
            worker, client, _ = self.build_worker(root)
            self.assertEqual(worker.run_once(), 0)
            self.assertEqual(client.claim_calls, 0)

    def test_worker_does_not_claim_without_a_moderation_provider(self):
        with tempfile.TemporaryDirectory() as root:
            worker, client, _ = self.build_worker(root, adapter=PngAdapter(), safety_gate=None)
            self.assertEqual(worker.run_once(), 0)
            self.assertEqual(client.claim_calls, 0)

    def test_prompt_moderation_blocks_before_inference(self):
        gate = FakeSafetyGate(block_prompt=True)
        with tempfile.TemporaryDirectory() as root:
            worker, client, assets = self.build_worker(root, adapter=PngAdapter(), safety_gate=gate)
            worker.run_once()
        self.assertEqual(client.failures[0]["error_code"], "SAFETY_REVIEW_REQUIRED")
        self.assertEqual(gate.prompt_checks, 1)
        self.assertEqual(gate.output_checks, 0)
        self.assertEqual(assets.uploads, [])

    def test_output_moderation_blocks_before_private_upload(self):
        gate = FakeSafetyGate(block_output=True)
        with tempfile.TemporaryDirectory() as root:
            worker, client, assets = self.build_worker(root, adapter=PngAdapter(), safety_gate=gate)
            worker.run_once()
        self.assertEqual(client.failures[0]["error_code"], "SAFETY_REVIEW_REQUIRED")
        self.assertEqual(gate.prompt_checks, 1)
        self.assertEqual(gate.output_checks, 1)
        self.assertEqual(assets.uploads, [])

    def test_moderation_outage_is_retryable_and_fails_closed(self):
        gate = FakeSafetyGate(unavailable=True)
        with tempfile.TemporaryDirectory() as root:
            worker, client, assets = self.build_worker(root, adapter=PngAdapter(), safety_gate=gate)
            worker.run_once()
        self.assertEqual(client.failures[0]["error_code"], "MODERATION_UNAVAILABLE")
        self.assertTrue(client.failures[0]["retryable"])
        self.assertEqual(assets.uploads, [])

    def test_worker_claims_validated_job_and_completes_with_private_asset(self):
        with tempfile.TemporaryDirectory() as root:
            worker, client, assets = self.build_worker(root, adapter=PngAdapter())
            self.assertEqual(worker.run_once(), 1)
            self.assertEqual(client.claim_calls, 1)
            self.assertEqual(len(assets.uploads), 1)
            self.assertEqual(len(client.completed), 1)
            output = client.completed[0]["output_asset"]
            self.assertEqual(output["mime_type"], "image/png")
            self.assertEqual(output["width"], 32)
            self.assertEqual(output["height"], 24)
            self.assertEqual(output["storage_path"], f"{USER_ID}/{JOB_ID}/{output['asset_id']}.png")
            self.assertEqual(client.failures, [])

    def test_missing_exact_model_revision_fails_without_fallback(self):
        job = make_job()
        job["request"]["model_revision"] = "different-revision"
        client = FakeClient([job])
        with tempfile.TemporaryDirectory() as root:
            worker, _, assets = self.build_worker(root, adapter=PngAdapter(), client=client)
            worker.run_once()
        self.assertEqual(client.failures[0]["error_code"], "MODEL_RUNTIME_UNAVAILABLE")
        self.assertEqual(assets.uploads, [])
        self.assertEqual(client.completed, [])

    def test_dimension_mismatch_is_rejected_before_upload(self):
        with tempfile.TemporaryDirectory() as root:
            worker, client, assets = self.build_worker(root, adapter=PngAdapter(dimensions=(64, 64)))
            worker.run_once()
        self.assertEqual(client.failures[0]["error_code"], "OUTPUT_DIMENSION_MISMATCH")
        self.assertEqual(assets.uploads, [])
        self.assertEqual(client.completed, [])

    def test_cooperative_cancellation_stops_before_upload(self):
        with tempfile.TemporaryDirectory() as root:
            worker, client, assets = self.build_worker(root, adapter=PngAdapter(cancel=True))
            worker.run_once()
        self.assertEqual(client.failures[0]["error_code"], "CANCELLED_BY_USER")
        self.assertEqual(assets.uploads, [])
        self.assertEqual(client.completed, [])

    def test_adapter_failure_uses_safe_error_code(self):
        with tempfile.TemporaryDirectory() as root:
            worker, client, assets = self.build_worker(
                root,
                adapter=PngAdapter(error=GenerationError("MODEL_TIMEOUT", retryable=True)),
            )
            worker.run_once()
        self.assertEqual(client.failures[0]["error_code"], "MODEL_TIMEOUT")
        self.assertTrue(client.failures[0]["retryable"])
        self.assertEqual(assets.uploads, [])

    def test_confirmed_lost_lease_after_upload_deletes_uncommitted_asset(self):
        client = FakeClient()
        client.complete_error = WorkerLeaseLost("lease expired")
        assets = FakeAssetStore()
        with tempfile.TemporaryDirectory() as root:
            worker, _, _ = self.build_worker(root, adapter=PngAdapter(), client=client, asset_store=assets)
            worker.run_once()
        self.assertEqual(len(assets.uploads), 1)
        self.assertEqual(len(assets.deleted), 1)
        self.assertEqual(client.completed, [])


if __name__ == "__main__":
    unittest.main()
