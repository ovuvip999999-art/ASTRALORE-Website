import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

from sandbox_executor import DockerSandboxExecutor, SandboxExecutionError
from sandbox_policy import SandboxConfig, SandboxLimits

IMAGE = "registry.example/astra/runtime@sha256:" + "b" * 64


class FakeProcess:
    def __init__(self, *, returncode=0, never_exit=False):
        self.returncode = returncode
        self.never_exit = never_exit
        self.stdin = Mock()
        self.pid = 12345
        self.killed = False

    def poll(self):
        return None if self.never_exit and not self.killed else self.returncode

    def wait(self, timeout=None):
        self.killed = True
        return self.returncode

    def kill(self):
        self.killed = True


class SandboxExecutorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.models = self.root / "models"
        self.models.mkdir()
        self.output = self.root / "output"
        self.output.mkdir()
        self.commands = []
        self.process = FakeProcess()

        def run_command(command, **kwargs):
            self.commands.append(command)
            if command[1:3] == ["cp", command[2]] and len(command) == 4:
                destination = Path(command[3])
                (destination / "result.png").write_bytes(b"valid-test-image")
            return Mock(returncode=0)

        self.run_command = run_command

    def executor(self, *, process=None, timeout=30):
        selected = process or self.process
        return DockerSandboxExecutor(
            config=SandboxConfig(
                image=IMAGE,
                model_directory=self.models,
                gpu_device="0",
                limits=SandboxLimits(timeout_seconds=timeout),
            ),
            popen_factory=lambda *args, **kwargs: selected,
            run_command=self.run_command,
            poll_interval=0.01,
            cleanup_timeout=0.5,
        )

    def test_success_collects_one_regular_output_and_removes_container(self):
        result = self.executor().execute(
            {"model_id": "test-model", "prompt": "test"},
            output_dir=self.output,
            cancel_event=threading.Event(),
        )
        self.assertEqual(result, self.output / "result.png")
        self.assertTrue(result.is_file())
        self.assertTrue(any(command[1:3] == ["rm", "-f"] for command in self.commands))

    def test_cancel_kills_container_and_returns_sanitized_error(self):
        event = threading.Event()
        event.set()
        with self.assertRaises(SandboxExecutionError) as caught:
            self.executor(process=FakeProcess(never_exit=True)).execute(
                {"model_id": "test-model"},
                output_dir=self.output,
                cancel_event=event,
            )
        self.assertEqual(caught.exception.error_code, "SANDBOX_CANCELLED")
        self.assertTrue(any(command[1:2] == ["kill"] for command in self.commands))
        self.assertTrue(any(command[1:3] == ["rm", "-f"] for command in self.commands))

    def test_nonzero_container_exit_is_rejected(self):
        with self.assertRaises(SandboxExecutionError) as caught:
            self.executor(process=FakeProcess(returncode=17)).execute(
                {"model_id": "test-model"},
                output_dir=self.output,
                cancel_event=threading.Event(),
            )
        self.assertEqual(caught.exception.error_code, "SANDBOX_EXIT_FAILED")

    def test_nonempty_output_directory_is_rejected_before_launch(self):
        (self.output / "unexpected.png").write_bytes(b"x")
        with self.assertRaises(SandboxExecutionError) as caught:
            self.executor().execute(
                {"model_id": "test-model"},
                output_dir=self.output,
                cancel_event=threading.Event(),
            )
        self.assertEqual(caught.exception.error_code, "SANDBOX_OUTPUT_INVALID")

    def test_failed_docker_copy_is_rejected_even_if_partial_file_exists(self):
        def failed_copy(command, **kwargs):
            self.commands.append(command)
            if command[1] == "cp":
                (self.output / "result.png").write_bytes(b"partial")
                return Mock(returncode=1)
            return Mock(returncode=0)

        executor = self.executor()
        executor.run_command = failed_copy
        with self.assertRaises(SandboxExecutionError) as caught:
            executor.execute(
                {"model_id": "test-model"},
                output_dir=self.output,
                cancel_event=threading.Event(),
            )
        self.assertEqual(caught.exception.error_code, "SANDBOX_OUTPUT_INVALID")

    def test_unsupported_output_file_is_rejected(self):
        def bad_copy(command, **kwargs):
            self.commands.append(command)
            if command[1] == "cp":
                (self.output / "payload.py").write_text("not media")
            return Mock(returncode=0)

        executor = self.executor()
        executor.run_command = bad_copy
        with self.assertRaises(SandboxExecutionError) as caught:
            executor.execute(
                {"model_id": "test-model"},
                output_dir=self.output,
                cancel_event=threading.Event(),
            )
        self.assertEqual(caught.exception.error_code, "SANDBOX_OUTPUT_INVALID")

    def test_payload_must_be_json_serializable_and_bounded(self):
        with self.assertRaises(SandboxExecutionError) as caught:
            self.executor().execute(
                {"not_json": object()},
                output_dir=self.output,
                cancel_event=threading.Event(),
            )
        self.assertEqual(caught.exception.error_code, "SANDBOX_PROTOCOL_INVALID")


if __name__ == "__main__":
    unittest.main()
