"""Trusted, one-job ASTRA model-runtime entrypoint.

The image must be built from reviewed, pinned runtime dependencies and contain
only code-owned adapters. The parent sends a bounded manifest and one job over
stdin; this process re-verifies the selected model files inside /models.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from runtime_manifest import load_manifest_json, verify_model_artifacts
from runtime_registry import build_adapter_registry
from sd35_adapter import make_sd35_factory
from wan21_adapter import make_wan_factory

MAX_REQUEST_BYTES = 1_000_000
MODEL_ROOT = Path("/models")
OUTPUT_ROOT = Path("/outputs")


class EntrypointError(RuntimeError):
    pass


def _read_request() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if not raw or len(raw) > MAX_REQUEST_BYTES:
        raise EntrypointError("REQUEST_INVALID")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, ValueError):
        raise EntrypointError("REQUEST_INVALID") from None
    if not isinstance(value, dict) or set(value) != {"model_id", "model_revision", "job", "manifest"}:
        raise EntrypointError("REQUEST_INVALID")
    if not isinstance(value["model_id"], str) or not isinstance(value["model_revision"], str):
        raise EntrypointError("REQUEST_INVALID")
    if not isinstance(value["job"], dict) or not isinstance(value["manifest"], dict):
        raise EntrypointError("REQUEST_INVALID")
    return value


def _model_directory(model: dict[str, Any]) -> Path:
    paths = [Path(item["resolved_path"]) for item in model["files"]]
    if not paths:
        raise EntrypointError("MODEL_ARTIFACTS_INVALID")
    common = Path(os.path.commonpath([str(path.parent) for path in paths]))
    try:
        common = common.resolve(strict=True)
        common.relative_to(MODEL_ROOT.resolve(strict=True))
    except (OSError, ValueError, RuntimeError):
        raise EntrypointError("MODEL_ARTIFACTS_INVALID") from None
    if not common.is_dir():
        raise EntrypointError("MODEL_ARTIFACTS_INVALID")
    return common


def _factory(runtime: str, model: dict[str, Any]):
    model_dir = _model_directory(model)
    if runtime == "diffusers":
        return make_sd35_factory(model_dir=model_dir)(model)
    if runtime == "wan-video":
        return make_wan21_factory(model_dir=model_dir)(model)
    raise EntrypointError("RUNTIME_NOT_ALLOWED")


def main() -> int:
    try:
        request = _read_request()
        manifest_models = load_manifest_json(json.dumps(request["manifest"], separators=(",", ":")))
        selected = [
            model for model in manifest_models
            if model["model_id"] == request["model_id"]
            and model["revision"] == request["model_revision"]
        ]
        if len(selected) != 1:
            raise EntrypointError("MODEL_RUNTIME_UNAVAILABLE")
        verified = verify_model_artifacts(selected, model_root=MODEL_ROOT)
        model = verified[0]
        if model["license_reviewed_by_owner"] is not True:
            raise EntrypointError("MODEL_LICENSE_NOT_REVIEWED")
        adapter = _factory(model["runtime"], model)
        if (
            getattr(adapter, "model_id", None) != model["model_id"]
            or getattr(adapter, "revision", None) != model["revision"]
            or not callable(getattr(adapter, "generate", None))
        ):
            raise EntrypointError("MODEL_RUNTIME_UNAVAILABLE")

        OUTPUT_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        if any(OUTPUT_ROOT.iterdir()):
            raise EntrypointError("OUTPUT_DIRECTORY_NOT_EMPTY")
        import threading
        cancel_event = threading.Event()
        output = adapter.generate(
            request["job"],
            output_dir=OUTPUT_ROOT,
            cancel_event=cancel_event,
        )
        output_path = Path(output)
        if output_path.is_symlink():
            raise EntrypointError("MODEL_OUTPUT_INVALID")
        resolved = output_path.resolve(strict=True)
        resolved.relative_to(OUTPUT_ROOT.resolve(strict=True))
        if not resolved.is_file() or resolved.stat().st_size <= 0:
            raise EntrypointError("MODEL_OUTPUT_INVALID")
        # Only a stable filename is emitted; file bytes remain in the output tmpfs.
        print(json.dumps({"ok": True, "filename": resolved.name}, separators=(",", ":")))
        return 0
    except Exception:
        # Never expose prompts, paths, stack traces, or runtime internals.
        print(json.dumps({"ok": False, "error": "INFERENCE_FAILED"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
