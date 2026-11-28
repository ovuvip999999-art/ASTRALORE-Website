"""Fail-closed Docker sandbox command builder for ASTRA model execution.

This module constructs a resource-bounded, network-isolated container command.
It does not start Docker or claim that a host is safe; deployment must use a
hardened container runtime and an administrator-owned image pinned by digest.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path

IMAGE_DIGEST_RE = re.compile(r"^[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$")
GPU_DEVICE_RE = re.compile(r"^[0-9]{1,3}$")
MIN_MEMORY = 4 * 1024**3
MAX_MEMORY = 128 * 1024**3
MAX_OUTPUT = 512 * 1024**2


class SandboxPolicyError(ValueError):
    """Raised when an execution sandbox cannot be proven to meet policy."""


@dataclass(frozen=True)
class SandboxLimits:
    memory_bytes: int = 16 * 1024**3
    cpu_count: float = 4.0
    pids: int = 128
    timeout_seconds: int = 1800
    output_bytes: int = MAX_OUTPUT
    shm_bytes: int = 2 * 1024**3


@dataclass(frozen=True)
class SandboxConfig:
    image: str
    model_directory: str | Path
    gpu_device: str
    limits: SandboxLimits = SandboxLimits()
    docker_executable: str = "docker"


def _directory(value: str | Path, label: str) -> Path:
    raw = Path(value)
    if raw.is_symlink():
        raise SandboxPolicyError(f"{label} cannot be a symbolic link.")
    try:
        resolved = raw.resolve(strict=True)
    except (OSError, RuntimeError):
        raise SandboxPolicyError(f"{label} must be an existing directory.") from None
    if not resolved.is_dir():
        raise SandboxPolicyError(f"{label} must be an existing directory.")
    return resolved


def validate_config(config: SandboxConfig) -> tuple[Path, SandboxLimits]:
    if not isinstance(config, SandboxConfig):
        raise SandboxPolicyError("An explicit sandbox configuration is required.")
    if not isinstance(config.image, str) or not IMAGE_DIGEST_RE.fullmatch(config.image):
        raise SandboxPolicyError("Sandbox image must be pinned by an immutable SHA-256 digest.")
    if not isinstance(config.docker_executable, str) or not config.docker_executable.strip():
        raise SandboxPolicyError("A Docker executable is required.")
    if not isinstance(config.gpu_device, str) or not GPU_DEVICE_RE.fullmatch(config.gpu_device):
        raise SandboxPolicyError("An explicit numeric GPU device is required.")
    limits = config.limits
    if not isinstance(limits, SandboxLimits):
        raise SandboxPolicyError("Sandbox resource limits are required.")
    if type(limits.memory_bytes) is not int or not MIN_MEMORY <= limits.memory_bytes <= MAX_MEMORY:
        raise SandboxPolicyError("Container memory must be between 4 and 128 GiB.")
    if isinstance(limits.cpu_count, bool) or not isinstance(limits.cpu_count, (int, float)) or not math.isfinite(limits.cpu_count) or not 1 <= limits.cpu_count <= 64:
        raise SandboxPolicyError("Container CPU quota must be between 1 and 64.")
    if type(limits.pids) is not int or not 32 <= limits.pids <= 1024:
        raise SandboxPolicyError("Container PID limit must be between 32 and 1024.")
    if type(limits.timeout_seconds) is not int or not 30 <= limits.timeout_seconds <= 3600:
        raise SandboxPolicyError("Container wall-clock limit must be between 30 and 3600 seconds.")
    if type(limits.output_bytes) is not int or not 1 <= limits.output_bytes <= MAX_OUTPUT:
        raise SandboxPolicyError("Container output tmpfs must be between 1 byte and 512 MiB.")
    if type(limits.shm_bytes) is not int or not 64 * 1024**2 <= limits.shm_bytes <= 8 * 1024**3:
        raise SandboxPolicyError("Container shared memory must be between 64 MiB and 8 GiB.")
    model_dir = _directory(config.model_directory, "Model directory")
    return model_dir, limits


def build_docker_command(config: SandboxConfig) -> list[str]:
    """Build a no-shell, no-network, resource-bounded Docker invocation."""
    model_dir, limits = validate_config(config)
    return [
        config.docker_executable,
        "run",
        "--rm",
        "--interactive",
        "--network", "none",
        "--read-only",
        "--user", "10001:10001",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--pids-limit", str(limits.pids),
        "--memory", str(limits.memory_bytes),
        "--memory-swap", str(limits.memory_bytes),
        "--cpus", str(limits.cpu_count),
        "--shm-size", str(limits.shm_bytes),
        "--tmpfs", f"/tmp:rw,noexec,nosuid,nodev,size=268435456,uid=10001,gid=10001,mode=0700",
        "--tmpfs", f"/outputs:rw,noexec,nosuid,nodev,size={limits.output_bytes},uid=10001,gid=10001,mode=0700",
        "--mount", f"type=bind,src={model_dir},dst=/models,readonly",
        "--gpus", f"device={config.gpu_device}",
        "--workdir", "/tmp",
        "--entrypoint", "python",
        config.image,
        "-m", "astra_sandbox_entrypoint",
    ]


def build_execution_plan(config: SandboxConfig) -> dict[str, object]:
    """Return the container command plus limits a parent supervisor must enforce."""
    _, limits = validate_config(config)
    return {
        "command": build_docker_command(config),
        "timeout_seconds": limits.timeout_seconds,
        "memory_bytes": limits.memory_bytes,
        "output_bytes": limits.output_bytes,
        "pids": limits.pids,
        "cpu_count": limits.cpu_count,
    }
