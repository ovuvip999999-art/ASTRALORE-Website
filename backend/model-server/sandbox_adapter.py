"""GenerationAdapter bridge that delegates one exact model job to Docker.

This adapter does not load model weights in the worker process. The supplied
executor must mount the same administrator-controlled model root at /models
and use a digest-pinned image containing astra_sandbox_entrypoint.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from sandbox_executor import DockerSandboxExecutor, SandboxExecutionError
from runtime_errors import GenerationError


class SandboxGenerationAdapter:
    def __init__(
        self,
        *,
        executor: DockerSandboxExecutor,
        verified_model: dict[str, Any],
    ) -> None:
        if not isinstance(executor, DockerSandboxExecutor):
            raise ValueError("A configured DockerSandboxExecutor is required.")
        if not isinstance(verified_model, dict):
            raise ValueError("A verified model manifest entry is required.")
        model_id = verified_model.get("model_id")
        revision = verified_model.get("revision")
        files = verified_model.get("files")
        if (
            not isinstance(model_id, str) or not model_id
            or not isinstance(revision, str) or not revision
            or not isinstance(files, list) or not files
            or verified_model.get("license_reviewed_by_owner") is not True
        ):
            raise ValueError("Verified, owner-reviewed model metadata is required.")
        self.executor = executor
        self.model_id = model_id
        self.revision = revision
        self.modality = verified_model.get("modality")
        runtime = verified_model.get("runtime")
        if (runtime, self.modality) not in {("diffusers", "image"), ("wan-video", "video")}:
            raise ValueError("Model runtime and modality are not supported by the trusted sandbox entrypoint.")
        self.manifest_entry = {
            key: verified_model[key]
            for key in (
                "model_id", "revision", "modality", "min_vram_mb",
                "max_width", "max_height", "max_pixels", "runtime",
                "allow_remote_code", "license_id", "license_reviewed_by_owner",
            )
        }
        self.manifest_entry["files"] = [
            {
                "path": item["path"],
                "sha256": item["sha256"],
                "size_bytes": item["size_bytes"],
            }
            for item in files
        ]

    def generate(
        self,
        job: dict[str, Any],
        *,
        output_dir: Path,
        cancel_event: threading.Event,
    ) -> Path:
        if not isinstance(job, dict) or not isinstance(job.get("request"), dict):
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        if job.get("model_id") != self.model_id:
            raise GenerationError("MODEL_RUNTIME_UNAVAILABLE", retryable=False)
        if job.get("modality") != self.modality:
            raise GenerationError("MODEL_RUNTIME_UNAVAILABLE", retryable=False)
        request_revision = job["request"].get("model_revision")
        if request_revision != self.revision:
            raise GenerationError("MODEL_RUNTIME_UNAVAILABLE", retryable=False)
        if cancel_event.is_set():
            raise GenerationError("CANCELLED_BY_USER", retryable=False)

        # Never forward lease tokens, owner IDs, storage metadata, or other
        # control-plane fields into the model container. The runtime receives
        # only the generation fields its code-owned adapters consume.
        allowed_request_fields = {
            "compiled_prompt", "prompt", "negative_prompt", "width", "height",
            "duration_seconds", "num_inference_steps", "guidance_scale", "seed",
        }
        request = job["request"]
        safe_request = {
            key: request[key]
            for key in allowed_request_fields
            if key in request
        }
        job_id = job.get("id")
        if not isinstance(job_id, str) or not 1 <= len(job_id) <= 128:
            raise GenerationError("INVALID_JOB_REQUEST", retryable=False)
        payload = {
            "model_id": self.model_id,
            "model_revision": self.revision,
            "job": {
                "id": job_id,
                "model_id": self.model_id,
                "modality": self.modality,
                "request": safe_request,
            },
            "manifest": {"models": [self.manifest_entry]},
        }
        try:
            return self.executor.execute(
                payload,
                output_dir=output_dir,
                cancel_event=cancel_event,
            )
        except SandboxExecutionError as exc:
            code_map = {
                "SANDBOX_TIMEOUT": ("INFERENCE_TIMEOUT", True),
                "SANDBOX_CANCELLED": ("CANCELLED_BY_USER", False),
                "SANDBOX_OUTPUT_TOO_LARGE": ("OUTPUT_VALIDATION_FAILED", False),
                "SANDBOX_OUTPUT_INVALID": ("OUTPUT_VALIDATION_FAILED", False),
                "SANDBOX_PROTOCOL_INVALID": ("INVALID_JOB_REQUEST", False),
            }
            code, retryable = code_map.get(exc.error_code, ("INFERENCE_FAILED", exc.retryable))
            raise GenerationError(code, retryable=retryable) from None



def build_sandbox_adapter_registry(
    verified_models: list[dict[str, Any]],
    *,
    executor: DockerSandboxExecutor,
) -> dict[tuple[str, str], SandboxGenerationAdapter]:
    """Bind verified model revisions only to the supervised container adapter."""
    if not isinstance(verified_models, list) or not isinstance(executor, DockerSandboxExecutor):
        raise ValueError("Verified models and a Docker sandbox executor are required.")
    model_root = Path(executor.config.model_directory).resolve(strict=True)
    registry: dict[tuple[str, str], SandboxGenerationAdapter] = {}
    for model in verified_models:
        if not isinstance(model, dict) or model.get("license_reviewed_by_owner") is not True:
            continue
        model_id, revision = model.get("model_id"), model.get("revision")
        files = model.get("files")
        if not isinstance(model_id, str) or not model_id or not isinstance(revision, str) or not revision:
            raise ValueError("Verified model identity is incomplete.")
        if not isinstance(files, list) or not files:
            raise ValueError("Verified model artifacts are required.")
        for item in files:
            if not isinstance(item, dict) or not isinstance(item.get("resolved_path"), str):
                raise ValueError("Model artifact paths must be verified before sandbox registration.")
            resolved = Path(item["resolved_path"]).resolve(strict=True)
            resolved.relative_to(model_root)
        key = (model_id, revision)
        if key in registry:
            raise ValueError("Duplicate model ID and revision in sandbox adapter registry.")
        registry[key] = SandboxGenerationAdapter(executor=executor, verified_model=model)
    return registry
