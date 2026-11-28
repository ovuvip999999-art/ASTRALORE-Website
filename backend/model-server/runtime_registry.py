"""Build worker adapters only from verified artifacts and code-owned factories.

The manifest can select a runtime label, but it cannot import code, choose a
Python module, or execute an arbitrary entry point.
"""
from __future__ import annotations

from typing import Any, Callable


class RuntimeRegistryError(ValueError):
    """Raised when verified model metadata cannot be bound to a trusted adapter."""


def build_adapter_registry(
    verified_models: list[dict[str, Any]],
    *,
    factories: dict[str, Callable[[dict[str, Any]], Any]],
) -> dict[tuple[str, str], Any]:
    if not isinstance(verified_models, list) or not isinstance(factories, dict):
        raise RuntimeRegistryError("Verified models and trusted factories must be supplied explicitly.")

    registry: dict[tuple[str, str], Any] = {}
    for model in verified_models:
        if not isinstance(model, dict):
            raise RuntimeRegistryError("Verified model entry must be an object.")
        model_id = model.get("model_id")
        revision = model.get("revision")
        runtime = model.get("runtime")
        files = model.get("files")
        if not all(isinstance(value, str) and value for value in (model_id, revision, runtime)):
            raise RuntimeRegistryError("Verified model identity is incomplete.")
        if not isinstance(files, list) or not files or any(
            not isinstance(item, dict) or not isinstance(item.get("resolved_path"), str)
            for item in files
        ):
            raise RuntimeRegistryError("Model artifacts have not been verified on disk.")

        key = (model_id, revision)
        if key in registry:
            raise RuntimeRegistryError("Duplicate model ID and revision in adapter registry.")

        factory = factories.get(runtime)
        if factory is None:
            # An approved manifest without an installed code-owned adapter is
            # intentionally unavailable and cannot be selected by the worker.
            continue
        if not callable(factory):
            raise RuntimeRegistryError("Runtime factory must be callable.")

        try:
            adapter = factory(model)
        except Exception:
            raise RuntimeRegistryError("Trusted runtime factory failed to initialize.") from None
        if (
            not callable(getattr(adapter, "generate", None))
            or getattr(adapter, "model_id", None) != model_id
            or getattr(adapter, "revision", None) != revision
        ):
            raise RuntimeRegistryError("Runtime adapter identity does not match its verified model manifest.")
        registry[key] = adapter
    return registry
