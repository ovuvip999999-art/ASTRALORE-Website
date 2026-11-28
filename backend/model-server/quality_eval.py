"""ASTRA's deterministic, human-rating benchmark aggregator.

This module never generates media or reads model weights. It validates run metadata
and blinded human ratings, then produces comparable modality-specific summaries.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

IMAGE_WEIGHTS = {
    "prompt_fidelity": 0.20,
    "composition": 0.15,
    "anatomy_object_integrity": 0.15,
    "lighting_materials": 0.15,
    "style_consistency": 0.10,
    "text_rendering": 0.10,
    "artifact_control": 0.15,
}
VIDEO_WEIGHTS = {
    "prompt_fidelity": 0.15,
    "composition": 0.10,
    "anatomy_object_integrity": 0.10,
    "lighting_materials": 0.10,
    "style_consistency": 0.10,
    "temporal_coherence": 0.20,
    "motion_quality": 0.15,
    "artifact_control": 0.10,
}
COMMON_RUN_FIELDS = {
    "sample_id", "blind_model_id", "modality", "prompt_id", "prompt",
    "model_revision", "runtime_version", "seed", "width", "height",
    "generation_seconds", "peak_vram_mb", "output_sha256",
}


class BenchmarkError(ValueError):
    """Raised when benchmark inputs are incomplete or inconsistent."""


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    rows = []
    with Path(path).open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise BenchmarkError(f"{path}:{line_number}: invalid JSON") from exc
            if not isinstance(row, dict):
                raise BenchmarkError(f"{path}:{line_number}: each row must be an object")
            rows.append(row)
    return rows


def _require_text(row: dict[str, Any], field: str) -> None:
    if not isinstance(row.get(field), str) or not row[field].strip():
        raise BenchmarkError(f"{field} must be a non-empty string")


def validate_runs(runs: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for row in runs:
        missing = COMMON_RUN_FIELDS - row.keys()
        if missing:
            raise BenchmarkError("run is missing fields: " + ", ".join(sorted(missing)))
        for field in ("sample_id", "blind_model_id", "prompt_id", "prompt", "model_revision", "runtime_version"):
            _require_text(row, field)
        if row["sample_id"] in seen:
            raise BenchmarkError(f"duplicate sample_id: {row['sample_id']}")
        seen.add(row["sample_id"])
        if row["modality"] not in ("image", "video"):
            raise BenchmarkError(f"unsupported modality for {row['sample_id']}")
        for field in ("width", "height", "seed", "peak_vram_mb"):
            if isinstance(row[field], bool) or not isinstance(row[field], int) or row[field] <= 0:
                raise BenchmarkError(f"{field} must be a positive integer for {row['sample_id']}")
        seconds = row["generation_seconds"]
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= 0:
            raise BenchmarkError(f"generation_seconds must be positive and finite for {row['sample_id']}")
        digest = row["output_sha256"]
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest.lower()):
            raise BenchmarkError(f"output_sha256 must be a 64-character SHA-256 hex digest for {row['sample_id']}")


def validate_ratings(ratings: list[dict[str, Any]], run_by_id: dict[str, dict[str, Any]]) -> None:
    seen: set[tuple[str, str]] = set()
    for row in ratings:
        for field in ("sample_id", "reviewer_alias", "scores"):
            if field not in row:
                raise BenchmarkError(f"rating is missing field: {field}")
        _require_text(row, "sample_id")
        _require_text(row, "reviewer_alias")
        sample_id = row["sample_id"]
        if sample_id not in run_by_id:
            raise BenchmarkError(f"rating references unknown sample_id: {sample_id}")
        key = (sample_id, row["reviewer_alias"])
        if key in seen:
            raise BenchmarkError(f"duplicate rating from reviewer for sample: {sample_id}")
        seen.add(key)
        modality = run_by_id[sample_id]["modality"]
        expected = set(IMAGE_WEIGHTS if modality == "image" else VIDEO_WEIGHTS)
        scores = row["scores"]
        if not isinstance(scores, dict) or set(scores) != expected:
            raise BenchmarkError(f"rating criteria do not match {modality} rubric for {sample_id}")
        for criterion, score in scores.items():
            if isinstance(score, bool) or not isinstance(score, int) or not 1 <= score <= 5:
                raise BenchmarkError(f"{criterion} must be an integer from 1 to 5 for {sample_id}")


def summarize(runs: list[dict[str, Any]], ratings: list[dict[str, Any]]) -> dict[str, Any]:
    validate_runs(runs)
    run_by_id = {row["sample_id"]: row for row in runs}
    validate_ratings(ratings, run_by_id)
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for rating in ratings:
        run = run_by_id[rating["sample_id"]]
        groups[(run["modality"], run["blind_model_id"])].append(rating)

    results = []
    for (modality, blind_model_id), group in sorted(groups.items()):
        weights = IMAGE_WEIGHTS if modality == "image" else VIDEO_WEIGHTS
        criterion_means = {
            name: round(sum(item["scores"][name] for item in group) / len(group), 3)
            for name in weights
        }
        composite = sum(criterion_means[name] * weight for name, weight in weights.items())
        sample_ids = sorted({item["sample_id"] for item in group})
        associated_runs = [run_by_id[sample_id] for sample_id in sample_ids]
        results.append({
            "modality": modality,
            "blind_model_id": blind_model_id,
            "rated_samples": len(sample_ids),
            "ratings": len(group),
            "weighted_quality_score_5": round(composite, 3),
            "criterion_means": criterion_means,
            "mean_generation_seconds": round(sum(r["generation_seconds"] for r in associated_runs) / len(associated_runs), 2),
            "mean_peak_vram_mb": round(sum(r["peak_vram_mb"] for r in associated_runs) / len(associated_runs)),
        })
    return {
        "schema_version": 1,
        "method": "equal-weight reviewer means followed by modality-specific weighted rubric",
        "results": results,
        "limitations": [
            "Scores are only comparable when models use the same prompt set and equivalent output settings.",
            "Blind labels must be assigned before reviewers see outputs; this tool does not anonymize media.",
            "Human ratings are subjective and should be reported with sample counts.",
            "Latency and VRAM are descriptive measurements, not part of the quality score.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Aggregate ASTRA blind creative-quality ratings.")
    parser.add_argument("--runs", required=True, help="JSONL file containing generation metadata")
    parser.add_argument("--ratings", required=True, help="JSONL file containing blind reviewer scores")
    parser.add_argument("--output", required=True, help="Path for summary JSON")
    args = parser.parse_args()
    runs = read_jsonl(args.runs)
    ratings = read_jsonl(args.ratings)
    report = summarize(runs, ratings)
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote benchmark report: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
