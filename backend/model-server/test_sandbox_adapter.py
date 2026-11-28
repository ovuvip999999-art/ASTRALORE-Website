import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

from sandbox_adapter import SandboxGenerationAdapter
from sandbox_executor import DockerSandboxExecutor, SandboxExecutionError
from worker_runner import GenerationError


class SandboxGenerationAdapterTests(unittest.TestCase):
    def setUp(self):
        self.executor = Mock(spec=DockerSandboxExecutor)
        self.model = {
            "model_id": "astra-test-image",
            "revision": "a" * 40,
            "modality": "image",
            "runtime": "diffusers",
            "license_id": "test-license",
            "license_reviewed_by_owner": True,
            "allow_remote_code": False,
            "min_vram_mb": 4096,
            "max_width": 1024,
            "max_height": 1024,
            "max_pixels": 1_000_000,
            "files": [{
                "path": "weights/model.safetensors",
                "sha256": "b" * 64,
                "size_bytes": 12,
                "resolved_path": "/models/weights/model.safetensors",
            }],
        }
        self.adapter = SandboxGenerationAdapter(executor=self.executor, verified_model=self.model)

    def job(self):
        return {
            "id": "job-1",
            "model_id": self.model["model_id"],
            "modality": "image",
            "request": {
                "model_revision": self.model["revision"],
                "compiled_prompt": "A test image",
                "width": 512,
                "height": 512,
            },
        }

    def test_passes_exact_model_and_minimal_verified_manifest_to_executor(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "result.png"
            self.executor.execute.return_value = output
            result = self.adapter.generate(
                self.job(),
                output_dir=Path(temp),
                cancel_event=threading.Event(),
            )
        self.assertEqual(result, output)
        payload = self.executor.execute.call_args.args[0]
        self.assertEqual(payload["model_id"], self.model["model_id"])
        self.assertEqual(payload["model_revision"], self.model["revision"])
        self.assertEqual(payload["manifest"]["models"][0]["files"][0], {
            "path": "weights/model.safetensors",
            "sha256": "b" * 64,
            "size_bytes": 12,
        })
        self.assertNotIn("resolved_path", payload["manifest"]["models"][0]["files"][0])

    def test_rejects_model_revision_mismatch_before_container_launch(self):
        job = self.job()
        job["request"]["model_revision"] = "c" * 40
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(GenerationError) as caught:
                self.adapter.generate(job, output_dir=Path(temp), cancel_event=threading.Event())
        self.assertEqual(caught.exception.error_code, "MODEL_RUNTIME_UNAVAILABLE")
        self.executor.execute.assert_not_called()

    def test_maps_container_cancellation_to_worker_cancellation(self):
        self.executor.execute.side_effect = SandboxExecutionError("SANDBOX_CANCELLED")
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(GenerationError) as caught:
                self.adapter.generate(self.job(), output_dir=Path(temp), cancel_event=threading.Event())
        self.assertEqual(caught.exception.error_code, "CANCELLED_BY_USER")


if __name__ == "__main__":
    unittest.main()
