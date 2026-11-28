import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from safety_gate import SafetyDecision
from sandbox_executor import DockerSandboxExecutor
from sandbox_policy import SandboxConfig
from worker_bootstrap import WorkerStartupError, build_generation_worker

MODEL_ID = "astra/test-image"
REVISION = "c" * 40


class FakeAdapter:
    def __init__(self, model):
        self.model_id = model["model_id"]
        self.revision = model["revision"]

    def generate(self, job, *, output_dir, cancel_event):
        return Path(output_dir) / "unused.png"


class FakeModerationProvider:
    def moderate_prompt(self, prompt, modality):
        return SafetyDecision("allow", "benign", 0.99)

    def moderate_output(self, media_path, modality):
        return SafetyDecision("allow", "none", 0.99)


class FakeClient:
    def __init__(self):
        self.claim_calls = 0

    def claim(self, **kwargs):
        self.claim_calls += 1
        return []


class FakeAssetStore:
    pass


class WorkerBootstrapTests(unittest.TestCase):
    def build_manifest(self, root, *, owner_reviewed=True):
        weight = Path(root) / "weights.bin"
        weight.write_bytes(b"ASTRA-TEST-WEIGHTS")
        payload = {
            "models": [{
                "model_id": MODEL_ID,
                "revision": REVISION,
                "modality": "image",
                "files": [{
                    "path": "weights.bin",
                    "sha256": hashlib.sha256(weight.read_bytes()).hexdigest(),
                    "size_bytes": weight.stat().st_size,
                }],
                "min_vram_mb": 4096,
                "max_width": 512,
                "max_height": 512,
                "max_pixels": 262144,
                "runtime": "diffusers",
                "allow_remote_code": False,
                "license_id": "test-license",
                "license_reviewed_by_owner": owner_reviewed,
            }]
        }
        return json.dumps(payload)

    def build(self, root, *, owner_reviewed=True, moderation=FakeModerationProvider(), executor=None):
        client = FakeClient()
        sandbox = executor or DockerSandboxExecutor(
            config=SandboxConfig(
                image="registry.example/astra/runtime@sha256:" + "b" * 64,
                model_directory=root,
                gpu_device="0",
            )
        )
        worker = build_generation_worker(
            manifest_json=self.build_manifest(root, owner_reviewed=owner_reviewed),
            model_root=root,
            sandbox_executor=sandbox,
            moderation_provider=moderation,
            client=client,
            asset_store=FakeAssetStore(),
            worker_id="bootstrap-test-worker",
            output_root=Path(root) / "worker-output",
        )
        return worker, client

    def test_builds_worker_from_verified_manifest_and_code_owned_factory(self):
        with tempfile.TemporaryDirectory() as root:
            worker, client = self.build(root)
            self.assertEqual(list(worker.adapters), [(MODEL_ID, REVISION)])
            self.assertEqual(type(worker.adapters[(MODEL_ID, REVISION)]).__name__, "SandboxGenerationAdapter")
            self.assertIsNotNone(worker.safety_gate)
            self.assertEqual(client.claim_calls, 0)

    def test_startup_refuses_missing_moderation_provider(self):
        with tempfile.TemporaryDirectory() as root:
            manifest = self.build_manifest(root)
            with self.assertRaises(WorkerStartupError):
                build_generation_worker(
                    manifest_json=manifest,
                    model_root=root,
                    sandbox_executor=DockerSandboxExecutor(config=SandboxConfig(
                        image="registry.example/astra/runtime@sha256:" + "b" * 64,
                        model_directory=root,
                        gpu_device="0",
                    )),
                    moderation_provider=None,
                    client=FakeClient(),
                    asset_store=FakeAssetStore(),
                    worker_id="test",
                    output_root=Path(root) / "output",
                )

    def test_startup_refuses_unreviewed_or_unavailable_model_runtime(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(WorkerStartupError):
                self.build(root, owner_reviewed=False)
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(WorkerStartupError):
                self.build(root, owner_reviewed=True, executor=object())

    def test_startup_refuses_model_artifact_tampering(self):
        with tempfile.TemporaryDirectory() as root:
            manifest = self.build_manifest(root)
            (Path(root) / "weights.bin").write_bytes(b"TAMPERED-TEST-WEIGHTS")
            with self.assertRaises(WorkerStartupError):
                build_generation_worker(
                    manifest_json=manifest,
                    model_root=root,
                    sandbox_executor=DockerSandboxExecutor(config=SandboxConfig(
                        image="registry.example/astra/runtime@sha256:" + "b" * 64,
                        model_directory=root,
                        gpu_device="0",
                    )),
                    moderation_provider=FakeModerationProvider(),
                    client=FakeClient(),
                    asset_store=FakeAssetStore(),
                    worker_id="test",
                    output_root=Path(root) / "output",
                )

    def test_startup_refuses_missing_queue_client_or_asset_store(self):
        with tempfile.TemporaryDirectory() as root:
            manifest = self.build_manifest(root)
            with self.assertRaises(WorkerStartupError):
                build_generation_worker(
                    manifest_json=manifest,
                    model_root=root,
                    sandbox_executor=DockerSandboxExecutor(config=SandboxConfig(
                        image="registry.example/astra/runtime@sha256:" + "b" * 64,
                        model_directory=root,
                        gpu_device="0",
                    )),
                    moderation_provider=FakeModerationProvider(),
                    client=None,
                    asset_store=FakeAssetStore(),
                    worker_id="test",
                    output_root=Path(root) / "output",
                )


if __name__ == "__main__":
    unittest.main()
