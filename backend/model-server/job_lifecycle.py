"""Storage-neutral ASTRA generation-job state machine.

This module defines legal transitions and validation only. It is not a queue,
database, worker, or distributed lock; those require a durable backend.
"""
from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime
from typing import Any

STATUSES = {"queued", "running", "succeeded", "failed", "cancelled"}
TERMINAL = {"succeeded", "failed", "cancelled"}
TRANSITIONS = {
    "queued": {"running", "cancelled"},
    "running": {"succeeded", "failed", "cancelled"},
    "succeeded": set(),
    "failed": set(),
    "cancelled": set(),
}
UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
ALLOWED_OUTPUT_TYPES = {
    "image/png", "image/jpeg", "image/webp",
    "video/mp4", "video/webm",
}


class JobStateError(ValueError):
    """Raised for invalid or illegal generation-job state changes."""


def _timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str):
        raise JobStateError(f"{field} must be an ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise JobStateError(f"{field} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise JobStateError(f"{field} must include a timezone")
    return parsed


def validate_output_asset(asset: Any, modality: str) -> dict[str, Any]:
    if not isinstance(asset, dict):
        raise JobStateError("successful jobs require output asset metadata")
    required = {"asset_id", "sha256", "mime_type", "size_bytes", "width", "height"}
    if required - asset.keys() or asset.keys() - (required | {"duration_ms"}):
        raise JobStateError("output asset metadata has missing or unknown fields")
    if not isinstance(asset["asset_id"], str) or not UUID_PATTERN.fullmatch(asset["asset_id"]):
        raise JobStateError("asset_id must be a UUID")
    if not isinstance(asset["sha256"], str) or not SHA256_PATTERN.fullmatch(asset["sha256"]):
        raise JobStateError("asset sha256 must be a 64-character hexadecimal digest")
    mime = asset["mime_type"]
    allowed = {"image/png", "image/jpeg", "image/webp"} if modality == "image" else {"video/mp4", "video/webm"}
    if mime not in allowed:
        raise JobStateError("output MIME type does not match job modality")
    for field in ("size_bytes", "width", "height"):
        value = asset[field]
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise JobStateError(f"{field} must be a positive integer")
    if asset["size_bytes"] > 512 * 1024 * 1024:
        raise JobStateError("output asset exceeds the 512 MiB safety ceiling")
    if modality == "video":
        duration = asset.get("duration_ms")
        if isinstance(duration, bool) or not isinstance(duration, int) or not 1 <= duration <= 120_000:
            raise JobStateError("video duration_ms must be from 1 to 120000")
    elif "duration_ms" in asset:
        raise JobStateError("image output cannot include duration_ms")
    return deepcopy(asset)


def validate_job(job: dict[str, Any]) -> dict[str, Any]:
    required = {
        "job_id", "owner_id", "modality", "model_id", "status",
        "created_at", "updated_at", "output_asset", "error_code",
    }
    if not isinstance(job, dict) or job.keys() != required:
        raise JobStateError("job record has missing or unknown fields")
    for field in ("job_id", "owner_id"):
        if not isinstance(job[field], str) or not UUID_PATTERN.fullmatch(job[field]):
            raise JobStateError(f"{field} must be a UUID")
    if not isinstance(job["model_id"], str) or not job["model_id"].strip() or len(job["model_id"]) > 128:
        raise JobStateError("model_id must be non-empty text up to 128 characters")
    if job["modality"] not in {"image", "video"}:
        raise JobStateError("modality must be image or video")
    if job["status"] not in STATUSES:
        raise JobStateError("job status is invalid")
    created = _timestamp(job["created_at"], "created_at")
    updated = _timestamp(job["updated_at"], "updated_at")
    if updated < created:
        raise JobStateError("updated_at cannot be earlier than created_at")
    if job["status"] == "succeeded":
        validate_output_asset(job["output_asset"], job["modality"])
        if job["error_code"] is not None:
            raise JobStateError("successful jobs cannot have an error_code")
    else:
        if job["output_asset"] is not None:
            raise JobStateError("only successful jobs may contain output_asset")
        if job["status"] == "failed":
            if not isinstance(job["error_code"], str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,63}", job["error_code"]):
                raise JobStateError("failed jobs require a safe machine-readable error_code")
        elif job["error_code"] is not None:
            raise JobStateError("non-failed jobs cannot have an error_code")
    return deepcopy(job)


def transition_job(
    job: dict[str, Any],
    target_status: str,
    *,
    updated_at: str,
    output_asset: dict[str, Any] | None = None,
    error_code: str | None = None,
) -> dict[str, Any]:
    current = validate_job(job)
    if target_status not in STATUSES:
        raise JobStateError("target status is invalid")
    if target_status == current["status"]:
        if output_asset is None and error_code is None:
            return current  # idempotent duplicate transition
        raise JobStateError("idempotent transition cannot replace terminal metadata")
    if target_status not in TRANSITIONS[current["status"]]:
        raise JobStateError(f"illegal job transition: {current['status']} -> {target_status}")
    new_time = _timestamp(updated_at, "updated_at")
    old_time = _timestamp(current["updated_at"], "updated_at")
    if new_time < old_time:
        raise JobStateError("updated_at cannot move backwards")

    updated = deepcopy(current)
    updated["status"] = target_status
    updated["updated_at"] = updated_at
    if target_status == "succeeded":
        updated["output_asset"] = validate_output_asset(output_asset, current["modality"])
        updated["error_code"] = None
    elif target_status == "failed":
        if not isinstance(error_code, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,63}", error_code):
            raise JobStateError("failed transition requires a safe machine-readable error_code")
        updated["output_asset"] = None
        updated["error_code"] = error_code
    else:
        if output_asset is not None or error_code is not None:
            raise JobStateError("cancelled/running transitions cannot attach output or error metadata")
        updated["output_asset"] = None
        updated["error_code"] = None
    return validate_job(updated)
