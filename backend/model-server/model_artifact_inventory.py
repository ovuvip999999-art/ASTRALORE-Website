"""Create a checksum inventory for model files already staged locally.

This tool never downloads weights, executes model code, or attests license review.
Every generated manifest deliberately sets license_reviewed_by_owner=False.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
from pathlib import Path, PurePosixPath
from typing import Any

from runtime_manifest import (
    MAX_FILES_PER_MODEL,
    MAX_FILE_BYTES,
    MAX_MODEL_BYTES,
    load_manifest_json,
)

MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
REVISION_RE = re.compile(r"^(?:[0-9a-f]{40}|sha256:[0-9a-f]{64})$")
RUNTIMES = {"diffusers", "wan-video", "custom"}
CHUNK_BYTES = 1024 * 1024


class InventoryError(ValueError):
    """Sanitized local model inventory failure."""


def _file_digest(path: Path) -> tuple[str, int]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        raise InventoryError("MODEL_FILE_OPEN_FAILED") from None
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise InventoryError("MODEL_FILE_NOT_REGULAR")
        if not 1 <= before.st_size <= MAX_FILE_BYTES:
            raise InventoryError("MODEL_FILE_SIZE_INVALID")
        digest = hashlib.sha256()
        with os.fdopen(fd, "rb", closefd=False) as handle:
            while True:
                chunk = handle.read(CHUNK_BYTES)
                if not chunk:
                    break
                digest.update(chunk)
        after = os.fstat(fd)
        signature_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        signature_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        if signature_before != signature_after:
            raise InventoryError("MODEL_FILE_CHANGED_DURING_HASH")
        return digest.hexdigest(), before.st_size
    finally:
        os.close(fd)


def _collect_files(root: Path) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    total_bytes = 0

    def visit(directory: Path) -> None:
        nonlocal total_bytes
        try:
            with os.scandir(directory) as iterator:
                entries = sorted(iterator, key=lambda item: item.name)
        except OSError:
            raise InventoryError("MODEL_DIRECTORY_READ_FAILED") from None
        for entry in entries:
            path = Path(entry.path)
            try:
                info = entry.stat(follow_symlinks=False)
            except OSError:
                raise InventoryError("MODEL_ENTRY_STAT_FAILED") from None
            if stat.S_ISLNK(info.st_mode):
                raise InventoryError("MODEL_SYMLINK_FORBIDDEN")
            if stat.S_ISDIR(info.st_mode):
                visit(path)
                continue
            if not stat.S_ISREG(info.st_mode):
                raise InventoryError("MODEL_NONREGULAR_FILE_FORBIDDEN")
            digest, size = _file_digest(path)
            total_bytes += size
            if total_bytes > MAX_MODEL_BYTES:
                raise InventoryError("MODEL_TOTAL_SIZE_EXCEEDED")
            relative = path.relative_to(root).as_posix()
            rel = PurePosixPath(relative)
            if rel.is_absolute() or any(part in {"", ".", ".."} for part in relative.split("/")):
                raise InventoryError("MODEL_PATH_INVALID")
            collected.append({"path": relative, "sha256": digest, "size_bytes": size})
            if len(collected) > MAX_FILES_PER_MODEL:
                raise InventoryError("MODEL_FILE_COUNT_EXCEEDED")

    visit(root)
    if not collected:
        raise InventoryError("MODEL_DIRECTORY_EMPTY")
    return collected


def build_inventory_manifest(
    *,
    model_root: str | Path,
    model_id: str,
    revision: str,
    modality: str,
    runtime: str,
    license_id: str,
    min_vram_mb: int,
    max_width: int,
    max_height: int,
    max_pixels: int,
) -> dict[str, Any]:
    root_input = Path(model_root)
    if root_input.is_symlink():
        raise InventoryError("MODEL_ROOT_SYMLINK_FORBIDDEN")
    try:
        root = root_input.resolve(strict=True)
    except (OSError, RuntimeError):
        raise InventoryError("MODEL_ROOT_UNAVAILABLE") from None
    if not root.is_dir():
        raise InventoryError("MODEL_ROOT_NOT_DIRECTORY")
    if not isinstance(model_id, str) or not MODEL_ID_RE.fullmatch(model_id):
        raise InventoryError("MODEL_ID_INVALID")
    if not isinstance(revision, str) or not REVISION_RE.fullmatch(revision):
        raise InventoryError("MODEL_REVISION_MUST_BE_IMMUTABLE")
    if not isinstance(modality, str) or modality not in {"image", "video"}:
        raise InventoryError("MODEL_MODALITY_INVALID")
    if not isinstance(runtime, str) or runtime not in RUNTIMES or (runtime == "wan-video" and modality != "video"):
        raise InventoryError("MODEL_RUNTIME_INVALID")
    if not isinstance(license_id, str) or not 1 <= len(license_id.strip()) <= 128:
        raise InventoryError("MODEL_LICENSE_ID_REQUIRED")
    if type(min_vram_mb) is not int or not 1024 <= min_vram_mb <= 131072:
        raise InventoryError("MODEL_VRAM_REQUIREMENT_INVALID")
    if type(max_width) is not int or not 64 <= max_width <= 16384:
        raise InventoryError("MODEL_MAX_WIDTH_INVALID")
    if type(max_height) is not int or not 64 <= max_height <= 16384:
        raise InventoryError("MODEL_MAX_HEIGHT_INVALID")
    if type(max_pixels) is not int or not 4096 <= max_pixels <= 100_000_000 or max_pixels > max_width * max_height:
        raise InventoryError("MODEL_MAX_PIXELS_INVALID")

    entry = {
        "model_id": model_id,
        "revision": revision,
        "modality": modality,
        "files": _collect_files(root),
        "min_vram_mb": min_vram_mb,
        "max_width": max_width,
        "max_height": max_height,
        "max_pixels": max_pixels,
        "runtime": runtime,
        "allow_remote_code": False,
        "license_id": license_id.strip(),
        "license_reviewed_by_owner": False,
    }
    payload = {"models": [entry]}
    try:
        load_manifest_json(json.dumps(payload, separators=(",", ":")))
    except Exception:
        raise InventoryError("GENERATED_MANIFEST_VALIDATION_FAILED") from None
    return payload


def write_manifest_exclusive(payload: dict[str, Any], output_path: str | Path, *, model_root: str | Path) -> None:
    output = Path(output_path)
    root = Path(model_root).resolve(strict=True)
    try:
        output_resolved = output.resolve(strict=False)
        output_resolved.relative_to(root)
    except ValueError:
        pass
    else:
        raise InventoryError("MANIFEST_OUTPUT_MUST_BE_OUTSIDE_MODEL_ROOT")
    if output.parent.is_symlink() or not output.parent.is_dir():
        raise InventoryError("MANIFEST_OUTPUT_DIRECTORY_INVALID")
    try:
        with output.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
    except FileExistsError:
        raise InventoryError("MANIFEST_OUTPUT_ALREADY_EXISTS") from None
    except OSError:
        raise InventoryError("MANIFEST_OUTPUT_WRITE_FAILED") from None


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory already-staged ASTRA model files.")
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--modality", choices=("image", "video"), required=True)
    parser.add_argument("--runtime", choices=tuple(sorted(RUNTIMES)), required=True)
    parser.add_argument("--license-id", required=True)
    parser.add_argument("--min-vram-mb", type=int, required=True)
    parser.add_argument("--max-width", type=int, required=True)
    parser.add_argument("--max-height", type=int, required=True)
    parser.add_argument("--max-pixels", type=int, required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        payload = build_inventory_manifest(
            model_root=args.model_root,
            model_id=args.model_id,
            revision=args.revision,
            modality=args.modality,
            runtime=args.runtime,
            license_id=args.license_id,
            min_vram_mb=args.min_vram_mb,
            max_width=args.max_width,
            max_height=args.max_height,
            max_pixels=args.max_pixels,
        )
        write_manifest_exclusive(payload, args.output, model_root=args.model_root)
    except InventoryError as exc:
        print(exc.args[0])
        return 1
    print("ASTRA_MODEL_INVENTORY_WRITTEN_LICENSE_REVIEW_REQUIRED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
