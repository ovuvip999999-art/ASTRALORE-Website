"""Read-only preflight for an explicitly digest-pinned ASTRA GPU runtime host.

This checks Docker daemon/image availability and NVIDIA device memory. It does
not start a container, download model weights, or enable generation.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from typing import Any, Callable

from sandbox_policy import SandboxConfig, validate_config


class HostPreflightError(RuntimeError):
    """Sanitized host capability failure."""


def _run(command: list[str], runner: Callable[..., Any], *, timeout: int = 15):
    try:
        result = runner(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=timeout,
            check=False,
            shell=False,
        )
    except Exception:
        raise HostPreflightError("HOST_PREFLIGHT_COMMAND_FAILED") from None
    if getattr(result, "returncode", 1) != 0:
        raise HostPreflightError("HOST_PREFLIGHT_COMMAND_FAILED")
    return getattr(result, "stdout", "")


def run_host_preflight(
    config: SandboxConfig,
    *,
    required_vram_mb: int,
    docker_runner: Callable[..., Any] = subprocess.run,
    gpu_runner: Callable[..., Any] = subprocess.run,
) -> dict[str, int | str]:
    if type(required_vram_mb) is not int or not 1024 <= required_vram_mb <= 131072:
        raise HostPreflightError("HOST_PREFLIGHT_REQUIREMENT_INVALID")
    try:
        validate_config(config)
    except Exception:
        raise HostPreflightError("HOST_PREFLIGHT_CONFIG_INVALID") from None

    docker_version = _run(
        [config.docker_executable, "info", "--format", "{{.ServerVersion}}"],
        docker_runner,
    ).strip()
    if not docker_version or len(docker_version) > 64:
        raise HostPreflightError("DOCKER_DAEMON_UNAVAILABLE")

    raw_digests = _run(
        [
            config.docker_executable,
            "image",
            "inspect",
            "--format",
            "{{json .RepoDigests}}",
            config.image,
        ],
        docker_runner,
    ).strip()
    try:
        digests = json.loads(raw_digests)
    except (TypeError, ValueError):
        raise HostPreflightError("RUNTIME_IMAGE_DIGEST_UNVERIFIED") from None
    if not isinstance(digests, list) or config.image not in digests:
        raise HostPreflightError("RUNTIME_IMAGE_DIGEST_UNVERIFIED")

    gpu_output = _run(
        [
            "nvidia-smi",
            "--query-gpu=index,memory.total,memory.free",
            "--format=csv,noheader,nounits",
        ],
        gpu_runner,
    )
    selected = None
    for line in gpu_output.splitlines():
        fields = [part.strip() for part in line.split(",")]
        if len(fields) != 3 or not all(part.isdigit() for part in fields):
            continue
        index, total_mb, free_mb = map(int, fields)
        if index == int(config.gpu_device):
            selected = (total_mb, free_mb)
            break
    if selected is None:
        raise HostPreflightError("GPU_DEVICE_UNAVAILABLE")
    total_mb, free_mb = selected
    if total_mb < required_vram_mb or free_mb < required_vram_mb:
        raise HostPreflightError("GPU_VRAM_INSUFFICIENT")

    return {
        "docker_server_version": docker_version,
        "runtime_image_digest": config.image,
        "gpu_device": config.gpu_device,
        "gpu_total_vram_mb": total_mb,
        "gpu_free_vram_mb": free_mb,
        "required_vram_mb": required_vram_mb,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only ASTRA Docker/GPU host preflight.")
    parser.add_argument("--image", required=True, help="Immutable image@sha256 digest reference.")
    parser.add_argument("--model-root", required=True, help="Existing administrator-controlled model directory.")
    parser.add_argument("--gpu-device", required=True, help="Explicit numeric NVIDIA GPU index.")
    parser.add_argument("--min-vram-mb", required=True, type=int)
    args = parser.parse_args()
    config = SandboxConfig(
        image=args.image,
        model_directory=args.model_root,
        gpu_device=args.gpu_device,
    )
    try:
        result = run_host_preflight(config, required_vram_mb=args.min_vram_mb)
    except HostPreflightError as exc:
        print(exc.args[0])
        return 1
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
