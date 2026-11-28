"""Offline structural readiness checks for staged ASTRA model packages.

This module reads local JSON metadata only. It never imports model libraries,
executes model code, downloads weights, or claims that inference will succeed.
"""
from __future__ import annotations

import argparse
import json
import os
import stat
from pathlib import Path
from typing import Any

from runtime_manifest import RuntimeManifestError, load_manifest_json, verify_model_artifacts

SD35_ID = "stabilityai/stable-diffusion-3.5-medium"
WAN_ID = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"

PROFILES = {
    SD35_ID: {
        "runtime": "diffusers",
        "modality": "image",
        "pipeline_class": "StableDiffusion3Pipeline",
        "components": {
            "scheduler": ("scheduler_config.json",),
            "text_encoder": ("config.json", "model.safetensors"),
            "text_encoder_2": ("config.json", "model.safetensors"),
            "text_encoder_3": ("config.json", "model.safetensors"),
            "tokenizer": ("tokenizer_config.json",),
            "tokenizer_2": ("tokenizer_config.json",),
            "tokenizer_3": ("tokenizer_config.json",),
            "transformer": ("config.json", "diffusion_pytorch_model.safetensors"),
            "vae": ("config.json", "diffusion_pytorch_model.safetensors"),
        },
    },
    WAN_ID: {
        "runtime": "wan-video",
        "modality": "video",
        "pipeline_class": "WanPipeline",
        "components": {
            "scheduler": ("scheduler_config.json",),
            "text_encoder": ("config.json", "model.safetensors"),
            "tokenizer": ("tokenizer_config.json",),
            "transformer": ("config.json", "diffusion_pytorch_model.safetensors"),
            "vae": ("config.json", "diffusion_pytorch_model.safetensors"),
        },
    },
}


class ModelReadinessError(ValueError):
    """Sanitized offline model package validation failure."""


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise ModelReadinessError("MODEL_METADATA_FILE_UNSAFE")
        if not 1 <= info.st_size <= 1_000_000:
            raise ModelReadinessError("MODEL_METADATA_FILE_SIZE_INVALID")
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except ModelReadinessError:
        raise
    except (OSError, UnicodeDecodeError, ValueError):
        raise ModelReadinessError("MODEL_METADATA_FILE_INVALID") from None
    if not isinstance(value, dict):
        raise ModelReadinessError("MODEL_METADATA_MUST_BE_JSON_OBJECT")
    return value


def _require_component_file(component_dir: Path, filename: str) -> Path:
    path = component_dir / filename
    try:
        info = path.lstat()
    except OSError:
        raise ModelReadinessError("MODEL_COMPONENT_FILE_MISSING") from None
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ModelReadinessError("MODEL_COMPONENT_FILE_UNSAFE")
    if filename.endswith(".safetensors") and info.st_size < 16:
        raise ModelReadinessError("MODEL_WEIGHT_FILE_TOO_SMALL")
    return path


def inspect_model_package(model: dict[str, Any], *, model_root: str | Path) -> dict[str, Any]:
    """Check one already checksum-verified model's expected Diffusers layout."""
    profile = PROFILES.get(model.get("model_id"))
    if profile is None:
        raise ModelReadinessError("MODEL_PROFILE_UNSUPPORTED")
    if model.get("runtime") != profile["runtime"] or model.get("modality") != profile["modality"]:
        raise ModelReadinessError("MODEL_PROFILE_MISMATCH")

    root_input = Path(model_root)
    if root_input.is_symlink():
        raise ModelReadinessError("MODEL_ROOT_SYMLINK_FORBIDDEN")
    try:
        root = root_input.resolve(strict=True)
    except (OSError, RuntimeError):
        raise ModelReadinessError("MODEL_ROOT_UNAVAILABLE") from None
    if not root.is_dir():
        raise ModelReadinessError("MODEL_ROOT_NOT_DIRECTORY")

    model_index = _read_json_object(root / "model_index.json")
    if model_index.get("_class_name") != profile["pipeline_class"]:
        raise ModelReadinessError("MODEL_PIPELINE_CLASS_MISMATCH")

    checked_components = []
    for component, required_files in profile["components"].items():
        component_dir = root / component
        try:
            info = component_dir.lstat()
        except OSError:
            raise ModelReadinessError("MODEL_COMPONENT_DIRECTORY_MISSING") from None
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise ModelReadinessError("MODEL_COMPONENT_DIRECTORY_UNSAFE")

        for filename in required_files:
            path = _require_component_file(component_dir, filename)
            if filename.endswith(".json"):
                _read_json_object(path)
        checked_components.append(component)

    declared = {
        str(Path(item["resolved_path"]).resolve(strict=True).relative_to(root)).replace(os.sep, "/")
        for item in model["files"]
    }
    required_metadata = {"model_index.json"}
    for component, filenames in profile["components"].items():
        required_metadata.update(
            f"{component}/{name}" for name in filenames if name.endswith(".json")
        )
    if not required_metadata.issubset(declared):
        raise ModelReadinessError("MODEL_MANIFEST_OMITS_REQUIRED_METADATA")

    return {
        "model_id": model["model_id"],
        "revision": model["revision"],
        "profile": profile["pipeline_class"],
        "checked_components": checked_components,
        "structure_valid": True,
        "license_reviewed_by_owner": model.get("license_reviewed_by_owner") is True,
        "inference_eligible": model.get("license_reviewed_by_owner") is True,
        "inference_performed": False,
    }


def inspect_manifest(raw_manifest: str, *, model_root: str | Path) -> list[dict[str, Any]]:
    manifest = load_manifest_json(raw_manifest)
    verified = verify_model_artifacts(manifest, model_root=model_root)
    reports = []
    for model in verified:
        try:
            reports.append(inspect_model_package(model, model_root=model_root))
        except ModelReadinessError as exc:
            reports.append({
                "model_id": model["model_id"],
                "revision": model["revision"],
                "structure_valid": False,
                "inference_eligible": False,
                "inference_performed": False,
                "error": str(exc),
            })
    return reports


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline ASTRA model package readiness check.")
    parser.add_argument("--manifest", required=True, help="Path to an existing runtime manifest JSON.")
    parser.add_argument("--model-root", required=True, help="Administrator-staged model directory.")
    args = parser.parse_args()
    try:
        manifest_path = Path(args.manifest)
        if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size > 1_000_000:
            raise ModelReadinessError("MODEL_MANIFEST_FILE_INVALID")
        raw = manifest_path.read_text(encoding="utf-8")
        reports = inspect_manifest(raw, model_root=args.model_root)
    except (OSError, UnicodeDecodeError, RuntimeManifestError, ModelReadinessError):
        print(json.dumps({"status": "blocked", "error": "MODEL_READINESS_CHECK_FAILED"}, separators=(",", ":")))
        return 1
    print(json.dumps({"status": "inspected", "models": reports}, separators=(",", ":")))
    return 0 if reports and all(item.get("structure_valid") and item.get("inference_eligible") for item in reports) else 2


if __name__ == "__main__":
    raise SystemExit(main())
