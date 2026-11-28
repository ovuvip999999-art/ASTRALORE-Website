"""Shared, sanitized generation error contract for worker and model runtime code."""
from __future__ import annotations

import re

_ERROR_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")


class GenerationError(RuntimeError):
    """A safe machine-readable inference failure."""

    def __init__(self, error_code: str, *, retryable: bool = False):
        if not isinstance(error_code, str) or not _ERROR_RE.fullmatch(error_code):
            raise ValueError("GenerationError requires a safe machine-readable code.")
        if not isinstance(retryable, bool):
            raise ValueError("retryable must be a boolean.")
        self.error_code = error_code
        self.retryable = retryable
        super().__init__(error_code)
