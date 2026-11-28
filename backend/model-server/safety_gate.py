"""Fail-closed prompt and output moderation contract for ASTRA workers."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class SafetyDecision:
    action: str
    category: str
    confidence: float


class ModerationProvider(Protocol):
    def moderate_prompt(self, prompt: str, modality: str) -> SafetyDecision:
        ...

    def moderate_output(self, media_path: Path, modality: str) -> SafetyDecision:
        ...


class SafetyGateError(RuntimeError):
    def __init__(self, error_code: str, *, retryable: bool = False):
        if error_code not in {"SAFETY_REVIEW_REQUIRED", "MODERATION_UNAVAILABLE"}:
            raise ValueError("Invalid safety gate error code.")
        self.error_code = error_code
        self.retryable = retryable
        super().__init__(error_code)


class SafetyGate:
    def __init__(self, provider: ModerationProvider, *, minimum_confidence: float = 0.90):
        if provider is None:
            raise ValueError("A reviewed moderation provider is required.")
        if (
            isinstance(minimum_confidence, bool)
            or not isinstance(minimum_confidence, (int, float))
            or not 0.5 <= minimum_confidence <= 1.0
        ):
            raise ValueError("minimum_confidence must be between 0.5 and 1.0.")
        self.provider = provider
        self.minimum_confidence = float(minimum_confidence)

    def _enforce(self, decision: SafetyDecision) -> None:
        if not isinstance(decision, SafetyDecision):
            raise SafetyGateError("MODERATION_UNAVAILABLE", retryable=True)
        if (
            not isinstance(decision.action, str)
            or not isinstance(decision.category, str)
            or decision.action != "allow"
            or decision.category not in {"none", "benign"}
            or isinstance(decision.confidence, bool)
            or not isinstance(decision.confidence, (int, float))
            or not 0.0 <= decision.confidence <= 1.0
            or decision.confidence < self.minimum_confidence
        ):
            raise SafetyGateError("SAFETY_REVIEW_REQUIRED", retryable=False)

    def check_prompt(self, prompt: str, modality: str) -> None:
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
            raise SafetyGateError("SAFETY_REVIEW_REQUIRED", retryable=False)
        if not isinstance(modality, str) or modality not in {"image", "video"}:
            raise SafetyGateError("SAFETY_REVIEW_REQUIRED", retryable=False)
        try:
            decision = self.provider.moderate_prompt(prompt, modality)
        except Exception:
            raise SafetyGateError("MODERATION_UNAVAILABLE", retryable=True) from None
        self._enforce(decision)

    def check_output(self, media_path: str | Path, modality: str) -> None:
        path = Path(media_path)
        if not path.is_file() or path.is_symlink() or not isinstance(modality, str) or modality not in {"image", "video"}:
            raise SafetyGateError("SAFETY_REVIEW_REQUIRED", retryable=False)
        try:
            decision = self.provider.moderate_output(path, modality)
        except Exception:
            raise SafetyGateError("MODERATION_UNAVAILABLE", retryable=True) from None
        self._enforce(decision)
