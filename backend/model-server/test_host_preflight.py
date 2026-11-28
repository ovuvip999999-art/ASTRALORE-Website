import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from host_preflight import HostPreflightError, run_host_preflight
from sandbox_policy import SandboxConfig

IMAGE = "registry.example/astra/runtime@sha256:" + "d" * 64


class HostPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.model_root = Path(self.temp.name) / "models"
        self.model_root.mkdir()
        self.config = SandboxConfig(
            image=IMAGE,
            model_directory=self.model_root,
            gpu_device="0",
        )

    def runners(self, *, total=24576, free=20000, digests=None):
        docker_calls = []
        def docker(command, **kwargs):
            docker_calls.append(command)
            output = "27.4.1" if command[1:2] == ["info"] else json.dumps(digests or [IMAGE])
            return Mock(returncode=0, stdout=output)
        def gpu(command, **kwargs):
            return Mock(returncode=0, stdout=f"0, {total}, {free}\n")
        return docker, gpu, docker_calls

    def test_passes_only_when_daemon_digest_and_selected_gpu_are_ready(self):
        docker, gpu, calls = self.runners()
        result = run_host_preflight(
            self.config,
            required_vram_mb=16000,
            docker_runner=docker,
            gpu_runner=gpu,
        )
        self.assertEqual(result["gpu_free_vram_mb"], 20000)
        self.assertEqual(result["runtime_image_digest"], IMAGE)
        self.assertEqual(len(calls), 2)

    def test_rejects_unverified_runtime_image_digest(self):
        docker, gpu, _ = self.runners(digests=["registry.example/astra/runtime:latest"])
        with self.assertRaises(HostPreflightError) as caught:
            run_host_preflight(
                self.config,
                required_vram_mb=16000,
                docker_runner=docker,
                gpu_runner=gpu,
            )
        self.assertEqual(caught.exception.args[0], "RUNTIME_IMAGE_DIGEST_UNVERIFIED")

    def test_rejects_insufficient_free_gpu_memory(self):
        docker, gpu, _ = self.runners(total=24576, free=8000)
        with self.assertRaises(HostPreflightError) as caught:
            run_host_preflight(
                self.config,
                required_vram_mb=16000,
                docker_runner=docker,
                gpu_runner=gpu,
            )
        self.assertEqual(caught.exception.args[0], "GPU_VRAM_INSUFFICIENT")

    def test_rejects_missing_gpu_device(self):
        docker, gpu, _ = self.runners()
        def missing_gpu(command, **kwargs):
            return Mock(returncode=0, stdout="1, 24576, 20000\n")
        with self.assertRaises(HostPreflightError) as caught:
            run_host_preflight(
                self.config,
                required_vram_mb=16000,
                docker_runner=docker,
                gpu_runner=missing_gpu,
            )
        self.assertEqual(caught.exception.args[0], "GPU_DEVICE_UNAVAILABLE")

    def test_never_runs_when_docker_daemon_is_unavailable(self):
        def failed(command, **kwargs):
            return Mock(returncode=1, stdout="")
        with self.assertRaises(HostPreflightError) as caught:
            run_host_preflight(
                self.config,
                required_vram_mb=16000,
                docker_runner=failed,
                gpu_runner=failed,
            )
        self.assertEqual(caught.exception.args[0], "HOST_PREFLIGHT_COMMAND_FAILED")


if __name__ == "__main__":
    unittest.main()
