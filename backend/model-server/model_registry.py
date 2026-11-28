"""Explicit, fail-closed model capability registry for ASTRA.

No implicit fallback is performed. The catalog is supplied by trusted server
configuration, not by browser requests. This module does not load model weights.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any

MODEL_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,127}$")
VALID_MODALITIES = {"image", "video"}
VALID_RATIOS = {"1:1", "9:16", "16:9"}
REQUIRED_FIELDS = {
    "model_id", "revision", "provider", "modalities", "aspect_ratios",
    "max_width", "max_height", "max_pixels", "min_vram_mb", "enabled",
}


class ModelRegistryError(ValueError):
    """Raised when model routing cannot be safely completed."""


def _positive_int(value: Any, field: str, model_id: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ModelRegistryError(f"{field} must be a positive integer for {model_id}")
    return value


def validate_catalog(catalog: Any) -> list[dict[str, Any]]:
    if not isinstance(catalog, list) or not catalog:
        raise ModelRegistryError("model catalog must be a non-empty list")
    seen: set[str] = set()
    validated = []
    for item in catalog:
        if not isinstance(item, dict):
            raise ModelRegistryError("each model catalog entry must be an object")
        missing = REQUIRED_FIELDS - item.keys()
        unknown = item.keys() - REQUIRED_FIELDS
        if missing or unknown:
            details = []
            if missing:
                details.append("missing fields: " + ", ".join(sorted(missing)))
            if unknown:
                details.append("unknown fields: " + ", ".join(sorted(unknown)))
            raise ModelRegistryError("; ".join(details))
        model_id = item["model_id"]
        if not isinstance(model_id, str) or not MODEL_ID_PATTERN.fullmatch(model_id):
            raise ModelRegistryError("model_id has an invalid format")
        if model_id in seen:
            raise ModelRegistryError(f"duplicate model_id: {model_id}")
        seen.add(model_id)
        for field in ("revision", "provider"):
            if not isinstance(item[field], str) or not item[field].strip() or len(item[field]) > 160:
                raise ModelRegistryError(f"{field} must be non-empty text for {model_id}")
        if not isinstance(item["enabled"], bool):
            raise ModelRegistryError(f"enabled must be boolean for {model_id}")
        modalities = item["modalities"]
        ratios = item["aspect_ratios"]
        if not isinstance(modalities, list) or not modalities or any(not isinstance(x, str) or x not in VALID_MODALITIES for x in modalities):
            raise ModelRegistryError(f"modalities are invalid for {model_id}")
        if len(set(modalities)) != len(modalities):
            raise ModelRegistryError(f"modalities contain duplicates for {model_id}")
        if not isinstance(ratios, list) or not ratios or any(not isinstance(x, str) or x not in VALID_RATIOS for x in ratios):
            raise ModelRegistryError(f"aspect_ratios are invalid for {model_id}")
        if len(set(ratios)) != len(ratios):
            raise ModelRegistryError(f"aspect_ratios contain duplicates for {model_id}")
        normalized = dict(item)
        for field in ("max_width", "max_height", "max_pixels", "min_vram_mb"):
            normalized[field] = _positive_int(item[field], field, model_id)
        validated.append(normalized)
    return validated


def load_catalog_json(raw: str) -> list[dict[str, Any]]:
    if not isinstance(raw, str) or not raw.strip():
        raise ModelRegistryError("ASTRA_MODEL_CATALOG_JSON is not configured")
    if len(raw) > 64_000:
        raise ModelRegistryError("model catalog configuration is too large")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ModelRegistryError("model catalog configuration is not valid JSON") from exc
    return validate_catalog(parsed)


def route_model(
    catalog: list[dict[str, Any]],
    *,
    model_id: str,
    modality: str,
    aspect_ratio: str,
    width: int,
    height: int,
) -> dict[str, Any]:
    """Validate one explicitly requested model; never silently choose another."""
    validated = validate_catalog(catalog)
    if not isinstance(model_id, str) or not MODEL_ID_PATTERN.fullmatch(model_id):
        raise ModelRegistryError("an explicit valid model_id is required")
    if modality not in VALID_MODALITIES:
        raise ModelRegistryError("modality must be image or video")
    if aspect_ratio not in VALID_RATIOS:
        raise ModelRegistryError("aspect_ratio is unsupported")
    width = _positive_int(width, "width", model_id)
    height = _positive_int(height, "height", model_id)
    ratio_value = width / height
    expected = {"1:1": 1.0, "9:16": 9 / 16, "16:9": 16 / 9}[aspect_ratio]
    if not math.isclose(ratio_value, expected, rel_tol=0.02, abs_tol=0.01):
        raise ModelRegistryError("requested dimensions do not match aspect_ratio")

    model = next((entry for entry in validated if entry["model_id"] == model_id), None)
    if model is None:
        raise ModelRegistryError("requested model_id is not in the server catalog")
    if not model["enabled"]:
        raise ModelRegistryError("requested model is disabled")
    if modality not in model["modalities"]:
        raise ModelRegistryError("requested model does not support this modality")
    if aspect_ratio not in model["aspect_ratios"]:
        raise ModelRegistryError("requested model does not support this aspect ratio")
    if width > model["max_width"] or height > model["max_height"]:
        raise ModelRegistryError("requested dimensions exceed this model's declared limits")
    if width * height > model["max_pixels"]:
        raise ModelRegistryError("requested pixel count exceeds this model's declared limit")

    # Return only safe capability metadata; never expose local paths or credentials.
    return {
        "model_id": model["model_id"],
        "revision": model["revision"],
        "provider": model["provider"],
        "modality": modality,
        "aspect_ratio": aspect_ratio,
        "width": width,
        "height": height,
        "min_vram_mb": model["min_vram_mb"],
        "routing_policy": "explicit-model-no-fallback",
        "runtime_preflight_required": True,
    }
