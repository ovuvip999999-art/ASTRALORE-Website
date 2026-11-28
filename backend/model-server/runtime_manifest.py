"""Strict, checksum-verified manifest for self-hosted model artifacts.

This module never downloads or loads weights and never executes model code.
It verifies files already placed inside an administrator-controlled model root.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
MAX_FILES_PER_MODEL = 1000
MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024
HASH_CHUNK = 1024 * 1024
RUNTIMES = {"diffusers", "wan-video", "custom"}


class RuntimeManifestError(ValueError):
    """Raised when a model artifact manifest or local artifact is unsafe."""


def _exact_keys(value: dict[str, Any], required: set[str], label: str) -> None:
    if set(value) != required:
        raise RuntimeManifestError(f"{label} has missing or unknown fields.")


def _safe_relative_path(value: Any) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value:
        raise RuntimeManifestError("Model artifact path must be a relative POSIX path.")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise RuntimeManifestError("Model artifact path contains unsafe components.")
    return path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            while True:
                block = handle.read(HASH_CHUNK)
                if not block:
                    break
                digest.update(block)
    except OSError:
        raise RuntimeManifestError("A declared model artifact could not be read.") from None
    return digest.hexdigest()


def _positive_int(value: Any, *, minimum: int, maximum: int, label: str) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise RuntimeManifestError(f"{label} is outside the permitted bounds.")
    return value


def load_manifest_json(raw: str) -> list[dict[str, Any]]:
    if not isinstance(raw, str) or not raw.strip() or len(raw.encode("utf-8")) > 1_000_000:
        raise RuntimeManifestError("Runtime manifest is empty or too large.")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        raise RuntimeManifestError("Runtime manifest must be valid JSON.") from None
    if not isinstance(payload, dict) or set(payload) != {"models"} or not isinstance(payload["models"], list):
        raise RuntimeManifestError("Runtime manifest must contain only a models array.")
    if len(payload["models"]) > 50:
        raise RuntimeManifestError("Runtime manifest contains too many model entries.")

    required = {
        "model_id", "revision", "modality", "files", "max_vram_mb",
        "max_width", "max_height", "max_pixels", "runtime", "allow_remote_code",
    }
    file_keys = {"path", "sha256", "size_bytes"}
    seen: set[tuple[str, str]] = set()
    normalized = []

    for item in payload["models"]:
        if not isinstance(item, dict):
            raise RuntimeManifestError("Each model entry must be an object.")
        _exact_keys(item, required, "Model entry")
        model_id = item["model_id"]
        revision = item["revision"]
        if not isinstance(model_id, str) or not MODEL_ID_RE.fullmatch(model_id):
            raise RuntimeManifestError("Model ID is invalid.")
        if not isinstance(revision, str) or not (COMMIT_RE.fullmatch(revision) or re.fullmatch(r"sha256:[0-9a-f]{64}", revision)):
            raise RuntimeManifestError("Model revision must be an immutable commit or SHA-256 identifier.")
        identity = (model_id, revision)
        if identity in seen:
            raise RuntimeManifestError("Duplicate model ID and revision.")
        seen.add(identity)
        if item["modality"] not in {"image", "video"}:
            raise RuntimeManifestError("Model modality must be image or video.")
        if item["runtime"] not in RUNTIMES:
            raise RuntimeManifestError("Model runtime is not in the approved runtime allowlist.")
        if item["allow_remote_code"] is not False:
            raise RuntimeManifestError("Remote model code execution is forbidden.")
        files = item["files"]
        if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES_PER_MODEL:
            raise RuntimeManifestError("Each model must declare a bounded non-empty file list.")
        seen_paths: set[str] = set()
        normalized_files = []
        for file_item in files:
            if not isinstance(file_item, dict):
                raise RuntimeManifestError("Model file entry must be an object.")
            _exact_keys(file_item, file_keys, "Model file")
            rel = _safe_relative_path(file_item["path"])
            rel_string = rel.as_posix()
            if rel_string in seen_paths:
                raise RuntimeManifestError("Duplicate model artifact path.")
            seen_paths.add(rel_string)
            digest = file_item["sha256"]
            if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
                raise RuntimeManifestError("Model artifact SHA-256 must be lowercase hexadecimal.")
            size = _positive_int(file_item["size_bytes"], minimum=1, maximum=MAX_FILE_BYTES, label="Model artifact size")
            normalized_files.append({"path": rel_string, "sha256": digest, "size_bytes": size})
        normalized.append({
            "model_id": model_id,
            "revision": revision,
            "modality": item["modality"],
            "files": normalized_files,
            "max_vram_mb": _positive_int(item["max_vram_mb"], minimum=1024, maximum=131072, label="max_vram_mb"),
            "max_width": _positive_int(item["max_width"], minimum=64, maximum=16384, label="max_width"),
            "max_height": _positive_int(item["max_height"], minimum=64, maximum=16384, label="max_height"),
            "max_pixels": _positive_int(item["max_pixels"], minimum=4096, maximum=100_000_000, label="max_pixels"),
            "runtime": item["runtime"],
            "allow_remote_code": False,
        })
    return normalized


def verify_model_artifacts(
    manifest: list[dict[str, Any]],
    *,
    model_root: str | Path,
) -> list[dict[str, Any]]:
    root_input = Path(model_root)
    if root_input.is_symlink():
        raise RuntimeManifestError("Model root cannot be a symbolic link.")
    try:
        root = root_input.resolve(strict=True)
    except (OSError, RuntimeError):
        raise RuntimeManifestError("Model root does not exist.") from None
    if not root.is_dir():
        raise RuntimeManifestError("Model root must be a directory.")

    verified = []
    for model in manifest:
        verified_files = []
        for file_item in model["files"]:
            rel = _safe_relative_path(file_item["path"])
            candidate = root
            for part in rel.parts:
                candidate = candidate / part
                if candidate.is_symlink():
                    raise RuntimeManifestError("Model artifacts cannot use symbolic links.")
            try:
                resolved = candidate.resolve(strict=True)
                resolved.relative_to(root)
                stat = resolved.stat()
            except (OSError, ValueError, RuntimeError):
                raise RuntimeManifestError("A model artifact is missing or outside the model root.") from None
            if not resolved.is_file() or stat.st_size != file_item["size_bytes"]:
                raise RuntimeManifestError("A model artifact size does not match the manifest.")
            if _sha256(resolved) != file_item["sha256"]:
                raise RuntimeManifestError("A model artifact checksum does not match the manifest.")
            verified_files.append({**file_item, "resolved_path": str(resolved)})
        verified.append({**model, "files": verified_files})
    return verified
