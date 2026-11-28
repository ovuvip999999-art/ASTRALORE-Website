"""Opt-in real Docker/GPU-host lifecycle probe; skipped in ordinary CI."""
from __future__ import annotations

import os
import re
import tempfile
import threading
import unittest
from pathlib import Path

from sandbox_executor import DockerSandboxExecutor
from sandbox_policy import SandboxConfig, SandboxLimits

IMAGE_RE = re.compile(r"^[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$")
ENABLED = os.environ.get("ASTRA_DOCKER_INTEGRATION") == "1"


@unittest.skipUnless(ENABLED, "Set ASTRA_DOCKER_INTEGRATION=1 on an authorized Docker/GPU host.")
class DockerHostIntegrationTests(unittest.TestCase):
    def test_real_container_runs_probe_and_collects_reported_output(self):
        image = os.environ.get("ASTRA_SANDBOX_TEST_IMAGE", "")
        gpu_device = os.environ.get("ASTRA_SANDBOX_TEST_GPU", "")
        if not IMAGE_RE.fullmatch(image):
            self.fail("ASTRA_SANDBOX_TEST_IMAGE must be an immutable image digest.")
        if not re.fullmatch(r"[0-9]{1,3}", gpu_device):
            self.fail("ASTRA_SANDBOX_TEST_GPU must name an explicit numeric GPU device.")

        with tempfile.TemporaryDirectory() as root:
            model_root = Path(root) / "models"
            output_root = Path(root) / "output"
            model_root.mkdir()
            output_root.mkdir()
            executor = DockerSandboxExecutor(
                config=SandboxConfig(
                    image=image,
                    model_directory=model_root,
                    gpu_device=gpu_device,
                    limits=SandboxLimits(timeout_seconds=60),
                )
            )
            output = executor.execute(
                {"probe": "astra-sandbox-host-probe"},
                output_dir=output_root,
                cancel_event=threading.Event(),
            )
            self.assertEqual(output.name, "sandbox-host-probe.png")
            self.assertEqual(output.read_bytes(), b"ASTRA-SANDBOX-HOST-PROBE")


if __name__ == "__main__":
    unittest.main()
