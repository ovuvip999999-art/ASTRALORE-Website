"""Fail-closed composition root for the ASTRA generation worker.

Callers must supply code-owned runtime factories and a reviewed moderation
provider. Manifest data never imports code or downloads model artifacts.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from runtime_manifest import RuntimeManifestError, load_manifest_json, verify_model_artifacts
from runtime_registry import RuntimeRegistryError, build_adapter_registry
from safety_gate import SafetyGate
from worker_runner import GenerationWorker


class WorkerStartupError(RuntimeError):
    """Sanitized startup failure; no jobs have been claimed."""


def build_generation_worker(
    *,
    manifest_json: str,
    model_root: str | Path,
    runtime_factories: dict[str, Callable[[dict[str, Any]], Any]],
    moderation_provider: Any,
    client: Any,
    asset_store: Any,
    worker_id: str,
    output_root: str | Path,
    batch_size: int = 1,
    lease_seconds: int = 120,
    heartbeat_interval: float = 20.0,
) -> GenerationWorker:
    if moderation_provider is None:
        raise WorkerStartupError("A reviewed moderation provider is required before worker startup.")
    if client is None or asset_store is None:
        raise WorkerStartupError("Private queue client and asset storage must be configured.")
    try:
        manifest = load_manifest_json(manifest_json)
        verified = verify_model_artifacts(manifest, model_root=model_root)
        adapters = build_adapter_registry(verified, factories=runtime_factories)
    except (RuntimeManifestError, RuntimeRegistryError, OSError, ValueError):
        raise WorkerStartupError("ASTRA model manifest or trusted runtime registry failed verification.") from None
    except Exception:
        raise WorkerStartupError("ASTRA model runtime initialization failed.") from None

    if not adapters:
        raise WorkerStartupError("No owner-reviewed model with an installed trusted runtime adapter is available.")

    try:
        gate = SafetyGate(moderation_provider)
        return GenerationWorker(
            client=client,
            asset_store=asset_store,
            adapters=adapters,
            safety_gate=gate,
            worker_id=worker_id,
            output_root=output_root,
            batch_size=batch_size,
            lease_seconds=lease_seconds,
            heartbeat_interval=heartbeat_interval,
        )
    except Exception:
        raise WorkerStartupError("ASTRA worker configuration failed validation.") from None
