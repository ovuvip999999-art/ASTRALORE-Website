"""Provider-agnostic, deterministic ASTRA Creative Brief Compiler.

This is structured brief normalization, not an LLM or a claim of natural-language
understanding. It preserves the user's original prompt and only assembles fields
the caller explicitly supplied.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

SCHEMA_VERSION = 1
ALLOWED_MODALITIES = {"image", "video"}
ALLOWED_RATIOS = {"1:1", "9:16", "16:9"}
TEXT_LIMITS = {
    "prompt": 2000,
    "style": 240,
    "composition": 400,
    "camera": 300,
    "lighting": 300,
    "environment": 500,
    "motion": 400,
}
LIST_LIMITS = {"subjects": (8, 240), "negative_constraints": (12, 240)}
ALLOWED_FIELDS = set(TEXT_LIMITS) | set(LIST_LIMITS) | {"modality", "aspect_ratio"}
ASSEMBLY_ORDER = (
    ("style", "Style"),
    ("subjects", "Subjects"),
    ("environment", "Environment"),
    ("composition", "Composition"),
    ("camera", "Camera"),
    ("lighting", "Lighting"),
    ("motion", "Motion"),
    ("negative_constraints", "Avoid"),
)


class BriefValidationError(ValueError):
    """Raised when a structured creative brief is invalid."""


def _clean_text(value: Any, field: str, limit: int) -> str:
    if not isinstance(value, str):
        raise BriefValidationError(f"{field} must be text")
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        raise BriefValidationError(f"{field} cannot be empty when supplied")
    if len(cleaned) > limit:
        raise BriefValidationError(f"{field} exceeds {limit} characters")
    if any(ord(char) < 32 and char not in "\t\n\r" for char in cleaned):
        raise BriefValidationError(f"{field} contains unsupported control characters")
    return cleaned


def normalize_brief(raw: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise BriefValidationError("brief must be an object")
    unknown = set(raw) - ALLOWED_FIELDS
    if unknown:
        raise BriefValidationError("unknown brief fields: " + ", ".join(sorted(unknown)))

    modality = raw.get("modality", "image")
    if modality not in ALLOWED_MODALITIES:
        raise BriefValidationError("modality must be image or video")
    ratio = raw.get("aspect_ratio", "16:9")
    if ratio not in ALLOWED_RATIOS:
        raise BriefValidationError("aspect_ratio must be 1:1, 9:16, or 16:9")

    normalized: dict[str, Any] = {
        "modality": modality,
        "aspect_ratio": ratio,
        "prompt": _clean_text(raw.get("prompt"), "prompt", TEXT_LIMITS["prompt"]),
    }
    for field, limit in TEXT_LIMITS.items():
        if field == "prompt" or field not in raw:
            continue
        if field == "motion" and modality != "video":
            raise BriefValidationError("motion is only valid for video briefs")
        normalized[field] = _clean_text(raw[field], field, limit)

    for field, (max_items, item_limit) in LIST_LIMITS.items():
        if field not in raw:
            continue
        values = raw[field]
        if not isinstance(values, list) or len(values) > max_items:
            raise BriefValidationError(f"{field} must be a list with at most {max_items} items")
        cleaned = [_clean_text(item, f"{field}[{index}]", item_limit) for index, item in enumerate(values)]
        if len({item.casefold() for item in cleaned}) != len(cleaned):
            raise BriefValidationError(f"{field} cannot contain duplicates")
        normalized[field] = cleaned

    if modality == "video" and "motion" not in normalized:
        # No motion is invented; omission is preserved for the downstream model.
        pass
    return normalized


def compile_brief(raw: dict[str, Any]) -> dict[str, Any]:
    brief = normalize_brief(raw)
    sections = [brief["prompt"]]
    for field, label in ASSEMBLY_ORDER:
        value = brief.get(field)
        if not value:
            continue
        rendered = "; ".join(value) if isinstance(value, list) else value
        sections.append(f"{label}: {rendered}")
    compiled_prompt = "\n".join(sections)
    digest_input = json.dumps(brief, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "schema_version": SCHEMA_VERSION,
        "brief": brief,
        "compiled_prompt": compiled_prompt,
        "brief_sha256": hashlib.sha256(digest_input.encode("utf-8")).hexdigest(),
        "compiler": "astra-deterministic-brief-v1",
        "notes": [
            "The original prompt is preserved as the first instruction.",
            "Only explicitly supplied structured fields are added; no scene details are invented.",
            "This compiler validates and assembles fields; it does not perform semantic prompt interpretation.",
        ],
    }
