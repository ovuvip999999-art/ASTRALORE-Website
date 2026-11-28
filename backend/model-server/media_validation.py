"""Inspect actual local media files before ASTRA marks a generation job successful.

Inputs must be files created inside a dedicated worker-owned directory. This
module never fetches URLs, never invokes a shell, and returns only verified
metadata; the caller remains responsible for private object storage.
"""
from __future__ import annotations

import hashlib
import json
import math
import subprocess
import warnings
from pathlib import Path
from typing import Any
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

MAX_BYTES = 512 * 1024 * 1024
MAX_DIMENSION = 16_384
MAX_PIXELS = 40_000_000
MAX_VIDEO_MS = 120_000
HASH_CHUNK = 1024 * 1024
IMAGE_MIME = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
}


class MediaValidationError(ValueError):
    """Raised when generated media is unsafe, malformed, or unsupported."""


def _safe_local_file(path: str | Path, work_dir: str | Path) -> tuple[Path, int]:
    try:
        root = Path(work_dir).resolve(strict=True)
        candidate = Path(path)
        if candidate.is_symlink():
            raise MediaValidationError("Media output cannot be a symbolic link.")
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except MediaValidationError:
        raise
    except (OSError, ValueError, RuntimeError):
        raise MediaValidationError("Media output must be a real file inside the worker output directory.") from None

    if not root.is_dir() or not resolved.is_file():
        raise MediaValidationError("Media output must be a regular local file.")
    try:
        size = resolved.stat().st_size
    except OSError:
        raise MediaValidationError("Media output could not be inspected.") from None
    if isinstance(size, bool) or not 1 <= size <= MAX_BYTES:
        raise MediaValidationError("Media output is empty or exceeds the 512 MiB limit.")
    return resolved, size


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(HASH_CHUNK)
                if not chunk:
                    break
                digest.update(chunk)
    except OSError:
        raise MediaValidationError("Media output could not be read for integrity verification.") from None
    return digest.hexdigest()


def _dimensions(width: Any, height: Any) -> tuple[int, int]:
    if isinstance(width, bool) or not isinstance(width, int) or isinstance(height, bool) or not isinstance(height, int):
        raise MediaValidationError("Media dimensions are invalid.")
    if not 1 <= width <= MAX_DIMENSION or not 1 <= height <= MAX_DIMENSION or width * height > MAX_PIXELS:
        raise MediaValidationError("Media dimensions exceed ASTRA's 16K / 40-megapixel worker limit.")
    return width, height


def _inspect_image(path: Path) -> tuple[str, int, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                image_format = image.format
                width, height = _dimensions(*image.size)
                mime = IMAGE_MIME.get(image_format or "")
                if not mime:
                    raise MediaValidationError("Only PNG, JPEG, and WebP image outputs are accepted.")
                image.verify()
            # verify() checks structure; reopening and decoding catches truncated/corrupt pixel data.
            with Image.open(path) as decoded:
                decoded.load()
                if decoded.format != image_format or decoded.size != (width, height):
                    raise MediaValidationError("Image metadata changed during validation.")
        return mime, width, height
    except MediaValidationError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise MediaValidationError("Image bytes are corrupt or could not be decoded safely.") from None


def _inspect_video(path: Path, ffprobe: str, timeout_seconds: float) -> tuple[str, int, int, int]:
    if not isinstance(ffprobe, str) or not ffprobe.strip() or not 1 <= timeout_seconds <= 20:
        raise MediaValidationError("Video inspector configuration is invalid.")
    command = [
        ffprobe, "-v", "error",
        "-protocol_whitelist", "file,pipe",
        "-probesize", "10M",
        "-analyzeduration", "10M",
        "-show_entries", "format=format_name,duration:stream=codec_type,width,height,duration",
        "-of", "json",
        str(path),
    ]
    try:
        result = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        raise MediaValidationError("Video inspection exceeded its time limit.") from None
    except (OSError, subprocess.SubprocessError):
        raise MediaValidationError("The local video inspector is unavailable.") from None

    if result.returncode != 0 or len(result.stdout) > 64_000:
        raise MediaValidationError("Video container inspection failed.")
    try:
        data = json.loads(result.stdout)
        fmt = data.get("format") or {}
        streams = data.get("streams") or []
    except (TypeError, ValueError):
        raise MediaValidationError("Video inspector returned invalid metadata.") from None

    format_names = fmt.get("format_name", "")
    if not isinstance(format_names, str):
        raise MediaValidationError("Video container format is invalid.")
    if "mp4" in format_names.split(",") or "mov" in format_names.split(","):
        mime = "video/mp4"
    elif "webm" in format_names.split(","):
        mime = "video/webm"
    else:
        raise MediaValidationError("Only MP4 and WebM video containers are accepted.")

    video_streams = [stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "video"]
    if len(video_streams) != 1:
        raise MediaValidationError("Video output must contain exactly one video stream.")
    stream = video_streams[0]
    width, height = _dimensions(stream.get("width"), stream.get("height"))

    duration_value = fmt.get("duration") or stream.get("duration")
    try:
        duration_seconds = float(duration_value)
    except (TypeError, ValueError):
        raise MediaValidationError("Video duration metadata is missing or invalid.") from None
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise MediaValidationError("Video duration metadata is invalid.")
    duration_ms = round(duration_seconds * 1000)
    if not 1 <= duration_ms <= MAX_VIDEO_MS:
        raise MediaValidationError("Video duration exceeds the 120-second limit.")
    return mime, width, height, duration_ms


def inspect_media_file(
    path: str | Path,
    *,
    work_dir: str | Path,
    modality: str,
    ffprobe: str = "ffprobe",
    video_timeout_seconds: float = 12.0,
) -> dict[str, Any]:
    """Return output metadata only after validating the actual local file bytes."""
    if modality not in {"image", "video"}:
        raise MediaValidationError("modality must be image or video.")
    resolved, size_bytes = _safe_local_file(path, work_dir)
    if modality == "image":
        mime, width, height = _inspect_image(resolved)
        result = {
            "asset_id": str(uuid4()),
            "sha256": _sha256(resolved),
            "mime_type": mime,
            "size_bytes": size_bytes,
            "width": width,
            "height": height,
        }
    else:
        mime, width, height, duration_ms = _inspect_video(resolved, ffprobe, video_timeout_seconds)
        result = {
            "asset_id": str(uuid4()),
            "sha256": _sha256(resolved),
            "mime_type": mime,
            "size_bytes": size_bytes,
            "width": width,
            "height": height,
            "duration_ms": duration_ms,
        }
    return result
