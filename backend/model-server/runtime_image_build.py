"""Build and smoke-test ASTRA's offline CUDA model-runtime image.

This performs no registry push, model download, or generation. The base image
must be supplied as an immutable repository@sha256 digest.
"""
from __future__ import annotations

import argparse
import re
import subprocess
from typing import Any, Callable

IMAGE_DIGEST_RE = re.compile(r"^[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$")
LOCAL_TAG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}:[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")
SMOKE_TEST = (
    "import torch, diffusers, transformers, astra_sandbox_entrypoint; "
    "assert torch.__version__.split('+')[0] == '2.5.1'; "
    "assert torch.version.cuda and torch.version.cuda.startswith('12.4'); "
    "print('ASTRA_RUNTIME_IMPORTS_OK')"
)


class RuntimeBuildError(RuntimeError):
    """Sanitized runtime image build or smoke-test failure."""


def build_runtime_image(
    *,
    base_image: str,
    local_tag: str,
    docker_executable: str = "docker",
    runner: Callable[..., Any] = subprocess.run,
    timeout_seconds: int = 7200,
) -> dict[str, str]:
    if not isinstance(base_image, str) or not IMAGE_DIGEST_RE.fullmatch(base_image):
        raise RuntimeBuildError("BASE_IMAGE_DIGEST_REQUIRED")
    if not isinstance(local_tag, str) or not LOCAL_TAG_RE.fullmatch(local_tag):
        raise RuntimeBuildError("LOCAL_IMAGE_TAG_INVALID")
    if not isinstance(docker_executable, str) or not docker_executable.strip():
        raise RuntimeBuildError("DOCKER_EXECUTABLE_INVALID")
    if type(timeout_seconds) is not int or not 60 <= timeout_seconds <= 14400:
        raise RuntimeBuildError("BUILD_TIMEOUT_INVALID")

    build = [
        docker_executable, "build", "--pull", "--no-cache",
        "--platform", "linux/amd64",
        "--build-arg", "PYTORCH_BASE_IMAGE=" + base_image,
        "--tag", local_tag,
        "--file", "Dockerfile.runtime", ".",
    ]
    smoke = [
        docker_executable, "run", "--rm", "--network", "none",
        "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=67108864",
        "--entrypoint", "python", local_tag, "-c", SMOKE_TEST,
    ]
    try:
        runner(
            build,
            cwd=".",
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout_seconds,
            check=True,
            shell=False,
        )
        result = runner(
            smoke,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=180,
            check=True,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeBuildError("RUNTIME_BUILD_OR_SMOKE_TEST_TIMED_OUT") from None
    except Exception:
        raise RuntimeBuildError("RUNTIME_BUILD_OR_SMOKE_TEST_FAILED") from None

    output = getattr(result, "stdout", "")
    if "ASTRA_RUNTIME_IMPORTS_OK" not in output:
        raise RuntimeBuildError("RUNTIME_SMOKE_TEST_OUTPUT_INVALID")
    return {
        "local_tag": local_tag,
        "base_image": base_image,
        "status": "build_and_import_smoke_test_passed",
        "registry_digest": "not_published",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and smoke-test the ASTRA model runtime.")
    parser.add_argument("--base-image", required=True, help="PyTorch CUDA base image pinned by @sha256 digest.")
    parser.add_argument("--tag", default="astra-model-runtime:validation")
    parser.add_argument("--docker", default="docker")
    args = parser.parse_args()
    try:
        result = build_runtime_image(
            base_image=args.base_image,
            local_tag=args.tag,
            docker_executable=args.docker,
        )
    except RuntimeBuildError as exc:
        print(exc.args[0])
        return 1
    import json
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
