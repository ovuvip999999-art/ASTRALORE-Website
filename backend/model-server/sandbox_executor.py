"""Parent-side supervisor for isolated ASTRA model-runtime containers.

The executor owns the container lifecycle. It never enables generation by itself:
callers must still pass readiness, model-license, moderation, queue and cost gates.
The runtime image must contain the trusted astra_sandbox_entrypoint module.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from sandbox_policy import SandboxConfig, build_docker_command, validate_config

CONTAINER_NAME_RE = re.compile(r"^astra-[a-f0-9]{32}$")
MAX_OUTPUT_FILES = 16
ALLOWED_OUTPUT_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm"}


class SandboxExecutionError(RuntimeError):
    """Sanitized sandbox execution failure with a stable machine code."""

    def __init__(self, code: str, *, retryable: bool = False):
        if code not in {
            "SANDBOX_START_FAILED", "SANDBOX_TIMEOUT", "SANDBOX_CANCELLED",
            "SANDBOX_EXIT_FAILED", "SANDBOX_OUTPUT_INVALID",
            "SANDBOX_OUTPUT_TOO_LARGE", "SANDBOX_PROTOCOL_INVALID",
        }:
            raise ValueError("Unsupported sandbox error code.")
        self.error_code = code
        self.retryable = retryable
        super().__init__(code)


class DockerSandboxExecutor:
    """Run one trusted runtime container and collect bounded regular-file outputs.

    popen_factory and run_command are injectable solely for deterministic tests.
    Production defaults use the Docker CLI without a shell.
    """

    def __init__(
        self,
        *,
        config: SandboxConfig,
        popen_factory: Callable[..., Any] = subprocess.Popen,
        run_command: Callable[..., Any] = subprocess.run,
        poll_interval: float = 0.05,
        cleanup_timeout: float = 5.0,
    ) -> None:
        validate_config(config)
        if not 0.01 <= poll_interval <= 1:
            raise ValueError("poll_interval must be between 0.01 and 1 second.")
        if not 0.5 <= cleanup_timeout <= 30:
            raise ValueError("cleanup_timeout must be between 0.5 and 30 seconds.")
        self.config = config
        self.popen_factory = popen_factory
        self.run_command = run_command
        self.poll_interval = poll_interval
        self.cleanup_timeout = cleanup_timeout

    def _docker(self, *args: str) -> bool:
        """Run a bounded Docker control command and report its real exit status."""
        command = [self.config.docker_executable, *args]
        try:
            result = self.run_command(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=self.cleanup_timeout,
                check=False,
                shell=False,
            )
            return getattr(result, "returncode", 1) == 0
        except Exception:
            return False

    def _prepare_output_dir(self, value: str | Path) -> Path:
        raw = Path(value)
        if raw.is_symlink():
            raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID")
        try:
            root = raw.resolve(strict=True)
        except (OSError, RuntimeError):
            raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID") from None
        if not root.is_dir() or any(root.iterdir()):
            raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID")
        return root

    def _collect_outputs(self, name: str, output_root: Path) -> Path:
        # docker cp can fail while leaving a partial destination. Never infer
        # success merely because a file happens to exist in the output folder.
        if not self._docker("cp", f"{name}:/outputs/.", str(output_root)):
            raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID", retryable=True)
        total = 0
        files: list[Path] = []
        try:
            for path in output_root.rglob("*"):
                if path.is_symlink():
                    raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID")
                if path.is_dir():
                    continue
                if not path.is_file() or path.suffix.lower() not in ALLOWED_OUTPUT_SUFFIXES:
                    raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID")
                resolved = path.resolve(strict=True)
                resolved.relative_to(output_root)
                size = resolved.stat().st_size
                total += size
                if size <= 0:
                    raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID")
                if total > self.config.limits.output_bytes:
                    raise SandboxExecutionError("SANDBOX_OUTPUT_TOO_LARGE")
                files.append(resolved)
                if len(files) > MAX_OUTPUT_FILES:
                    raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID")
        except SandboxExecutionError:
            raise
        except (OSError, ValueError, RuntimeError):
            raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID") from None
        if len(files) != 1:
            raise SandboxExecutionError("SANDBOX_OUTPUT_INVALID")
        return files[0]

    def execute(
        self,
        payload: dict[str, Any],
        *,
        output_dir: str | Path,
        cancel_event: threading.Event,
    ) -> Path:
        if not isinstance(payload, dict) or not isinstance(cancel_event, threading.Event):
            raise SandboxExecutionError("SANDBOX_PROTOCOL_INVALID")
        try:
            encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        except (TypeError, ValueError):
            raise SandboxExecutionError("SANDBOX_PROTOCOL_INVALID") from None
        if len(encoded) > 1_000_000:
            raise SandboxExecutionError("SANDBOX_PROTOCOL_INVALID")

        output_root = self._prepare_output_dir(output_dir)
        name = "astra-" + uuid.uuid4().hex
        if not CONTAINER_NAME_RE.fullmatch(name):
            raise SandboxExecutionError("SANDBOX_START_FAILED")

        command = build_docker_command(self.config)
        command.remove("--rm")
        command[2:2] = ["--name", name]
        process = None
        try:
            process = self.popen_factory(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                shell=False,
                start_new_session=(os.name != "nt"),
            )
            try:
                process.stdin.write(encoded)
                process.stdin.close()
            except (BrokenPipeError, OSError):
                raise SandboxExecutionError("SANDBOX_START_FAILED", retryable=True) from None

            deadline = time.monotonic() + self.config.limits.timeout_seconds
            while process.poll() is None:
                if cancel_event.is_set():
                    raise SandboxExecutionError("SANDBOX_CANCELLED")
                if time.monotonic() >= deadline:
                    raise SandboxExecutionError("SANDBOX_TIMEOUT", retryable=True)
                cancel_event.wait(self.poll_interval)

            if process.returncode != 0:
                raise SandboxExecutionError("SANDBOX_EXIT_FAILED", retryable=True)
            output_path = self._collect_outputs(name, output_root)
            # A successful generation is not reported until Docker confirms
            # that the stopped container can be removed.
            if not self._docker("rm", "-f", name):
                raise SandboxExecutionError("SANDBOX_EXIT_FAILED", retryable=True)
            return output_path
        except SandboxExecutionError:
            raise
        except Exception:
            raise SandboxExecutionError("SANDBOX_START_FAILED", retryable=True) from None
        finally:
            if process is not None and process.poll() is None:
                self._docker("kill", name)
                try:
                    process.wait(timeout=self.cleanup_timeout)
                except Exception:
                    try:
                        if os.name == "nt":
                            process.kill()
                        else:
                            os.killpg(process.pid, signal.SIGKILL)
                    except Exception:
                        try:
                            process.kill()
                        except Exception:
                            pass
            self._docker("rm", "-f", name)
