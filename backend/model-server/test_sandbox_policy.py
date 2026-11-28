import tempfile
import unittest
from pathlib import Path

from sandbox_policy import (
    SandboxConfig, SandboxLimits, SandboxPolicyError,
    build_docker_command, build_execution_plan, validate_config,
)

IMAGE = "registry.example/astra/runtime@sha256:" + "a" * 64


class SandboxPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.model_dir = Path(self.temp.name) / "model"
        self.model_dir.mkdir()

    def config(self, **kwargs):
        values = {
            "image": IMAGE,
            "model_directory": self.model_dir,
            "gpu_device": "0",
        }
        values.update(kwargs)
        return SandboxConfig(**values)

    def test_command_has_isolation_and_resource_controls(self):
        command = build_docker_command(self.config())
        self.assertIn("--network", command)
        self.assertEqual(command[command.index("--network") + 1], "none")
        self.assertIn("--read-only", command)
        self.assertIn("--cap-drop", command)
        self.assertEqual(command[command.index("--cap-drop") + 1], "ALL")
        self.assertIn("--memory-swap", command)
        self.assertEqual(command[command.index("--memory-swap") + 1], command[command.index("--memory") + 1])
        self.assertIn("--pids-limit", command)
        self.assertIn("--cpus", command)
        self.assertIn("--gpus", command)
        self.assertIn("no-new-privileges:true", command)
        self.assertTrue(any(item.startswith("/outputs:rw,noexec,nosuid,nodev,size=") and "uid=10001" in item and "mode=0700" in item for item in command if item.startswith("/outputs:")))
        self.assertTrue(any(item.startswith("/tmp:rw,noexec,nosuid,nodev,size=") and "uid=10001" in item for item in command if item.startswith("/tmp:"))))

    def test_model_mount_is_read_only_and_command_has_no_shell(self):
        command = build_docker_command(self.config())
        mount = command[command.index("--mount") + 1]
        self.assertTrue(mount.endswith(",readonly"))
        self.assertNotIn("sh", command)
        self.assertNotIn("-c", command)

    def test_image_must_be_digest_pinned(self):
        with self.assertRaises(SandboxPolicyError):
            build_docker_command(self.config(image="registry.example/astra:latest"))

    def test_gpu_device_must_be_explicit_numeric(self):
        for device in ("all", "0,1", "../0", ""):
            with self.subTest(device=device), self.assertRaises(SandboxPolicyError):
                build_docker_command(self.config(gpu_device=device))

    def test_rejects_invalid_resource_limits(self):
        for limits in (
            SandboxLimits(memory_bytes=1024),
            SandboxLimits(cpu_count=0),
            SandboxLimits(pids=1),
            SandboxLimits(timeout_seconds=99999),
            SandboxLimits(output_bytes=MAX_OUTPUT_PLUS_ONE),
            SandboxLimits(shm_bytes=1),
        ):
            with self.subTest(limits=limits), self.assertRaises(SandboxPolicyError):
                validate_config(self.config(limits=limits))

    def test_model_directory_must_exist_and_not_be_symlink(self):
        missing = Path(self.temp.name) / "missing"
        with self.assertRaises(SandboxPolicyError):
            build_docker_command(self.config(model_directory=missing))
        link = Path(self.temp.name) / "model-link"
        try:
            link.symlink_to(self.model_dir, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("Symlinks are unavailable on this runner.")
        with self.assertRaises(SandboxPolicyError):
            build_docker_command(self.config(model_directory=link))

    def test_execution_plan_exposes_supervisor_wall_clock_limit(self):
        plan = build_execution_plan(self.config(limits=SandboxLimits(timeout_seconds=300)))
        self.assertEqual(plan["timeout_seconds"], 300)
        self.assertEqual(plan["output_bytes"], MAX_OUTPUT_PLUS_ONE - 1)
        self.assertEqual(plan["memory_bytes"], 16 * 1024**3)

    def test_limits_reject_boolean_values(self):
        with self.assertRaises(SandboxPolicyError):
            validate_config(self.config(limits=SandboxLimits(memory_bytes=True)))


MAX_OUTPUT_PLUS_ONE = 512 * 1024 * 1024 + 1


if __name__ == "__main__":
    unittest.main()
