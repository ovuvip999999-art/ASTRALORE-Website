"""Bounded HTTPS client for an administrator-operated ASTRA moderation service.

This is a transport adapter, not a moderation model. The configured private
service must perform both prompt and generated-media classification. All
transport, schema, size, and timeout failures fail closed in SafetyGate.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from safety_gate import SafetyDecision

MAX_PROMPT_CHARS = 4000
MAX_MEDIA_BYTES = 64 * 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
MAX_TOKEN_CHARS = 4096


class ModerationTransportError(RuntimeError):
    """Sanitized failure communicating with the moderation service."""


@dataclass(frozen=True)
class ModerationServiceConfig:
    base_url: str
    bearer_token: str
    timeout_seconds: float = 15.0

    def __post_init__(self):
        parsed = urllib.parse.urlsplit(self.base_url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
        ):
            raise ValueError("Moderation endpoint must be a clean HTTPS origin.")
        if (
            not isinstance(self.bearer_token, str)
            or not 32 <= len(self.bearer_token) <= MAX_TOKEN_CHARS
            or any(ord(char) < 33 or ord(char) > 126 for char in self.bearer_token)
        ):
            raise ValueError("Moderation bearer token is invalid.")
        if (
            isinstance(self.timeout_seconds, bool)
            or not isinstance(self.timeout_seconds, (int, float))
            or not 1 <= self.timeout_seconds <= 60
        ):
            raise ValueError("Moderation timeout must be between 1 and 60 seconds.")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HTTPSModerationProvider:
    def __init__(
        self,
        config: ModerationServiceConfig,
        *,
        opener: Any | None = None,
        ssl_context: ssl.SSLContext | None = None,
    ):
        if not isinstance(config, ModerationServiceConfig):
            raise ValueError("A validated moderation service configuration is required.")
        self.config = config
        context = ssl_context or ssl.create_default_context()
        self.opener = opener or urllib.request.build_opener(
            _NoRedirect(),
            urllib.request.HTTPSHandler(context=context),
        )

    def _post(self, route: str, payload: dict[str, Any]) -> SafetyDecision:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        if len(body) > MAX_MEDIA_BYTES * 2:
            raise ModerationTransportError("MODERATION_REQUEST_TOO_LARGE")
        url = self.config.base_url.rstrip("/") + route
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "Authorization": "Bearer " + self.config.bearer_token,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=self.config.timeout_seconds) as response:
                status = getattr(response, "status", 200)
                if status != 200:
                    raise ModerationTransportError("MODERATION_HTTP_FAILED")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except ModerationTransportError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise ModerationTransportError("MODERATION_TRANSPORT_FAILED") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ModerationTransportError("MODERATION_RESPONSE_TOO_LARGE")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ModerationTransportError("MODERATION_RESPONSE_INVALID") from None
        if not isinstance(value, dict) or set(value) != {"action", "category", "confidence"}:
            raise ModerationTransportError("MODERATION_RESPONSE_INVALID")
        action, category, confidence = value["action"], value["category"], value["confidence"]
        if (
            not isinstance(action, str)
            or not isinstance(category, str)
            or isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
        ):
            raise ModerationTransportError("MODERATION_RESPONSE_INVALID")
        return SafetyDecision(action, category, float(confidence))

    def check_ready(self) -> dict[str, str]:
        """Require the service to confirm all ASTRA moderation modalities at startup."""
        request = urllib.request.Request(
            self.config.base_url.rstrip("/") + "/health/ready",
            headers={
                "Authorization": "Bearer " + self.config.bearer_token,
                "Accept": "application/json",
            },
            method="GET",
        )
        try:
            with self.opener.open(request, timeout=self.config.timeout_seconds) as response:
                if getattr(response, "status", 200) != 200:
                    raise ModerationTransportError("MODERATION_NOT_READY")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except ModerationTransportError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise ModerationTransportError("MODERATION_NOT_READY") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ModerationTransportError("MODERATION_RESPONSE_TOO_LARGE")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ModerationTransportError("MODERATION_RESPONSE_INVALID") from None
        if (
            not isinstance(value, dict)
            or set(value) != {"status", "model_version", "capabilities"}
            or value.get("status") != "ready"
            or not isinstance(value.get("model_version"), str)
            or not 1 <= len(value["model_version"]) <= 128
            or not isinstance(value.get("capabilities"), list)
            or not {"prompt", "image", "video"}.issubset(value["capabilities"])
            or any(not isinstance(item, str) for item in value["capabilities"])
        ):
            raise ModerationTransportError("MODERATION_NOT_READY")
        return {"status": "ready", "model_version": value["model_version"]}

    def moderate_prompt(self, prompt: str, modality: str) -> SafetyDecision:
        if (
            not isinstance(prompt, str)
            or not 1 <= len(prompt.strip()) <= MAX_PROMPT_CHARS
            or modality not in {"image", "video"}
        ):
            raise ModerationTransportError("MODERATION_INPUT_INVALID")
        return self._post("/v1/moderate/prompt", {
            "prompt": prompt,
            "modality": modality,
        })

    def moderate_output(self, media_path: Path, modality: str) -> SafetyDecision:
        path = Path(media_path)
        if (
            modality not in {"image", "video"}
            or path.is_symlink()
            or not path.is_file()
        ):
            raise ModerationTransportError("MODERATION_INPUT_INVALID")
        try:
            size = path.stat().st_size
            if not 1 <= size <= MAX_MEDIA_BYTES:
                raise ModerationTransportError("MODERATION_MEDIA_SIZE_UNSUPPORTED")
            content = path.read_bytes()
        except ModerationTransportError:
            raise
        except OSError:
            raise ModerationTransportError("MODERATION_MEDIA_UNAVAILABLE") from None
        if len(content) != size:
            raise ModerationTransportError("MODERATION_MEDIA_CHANGED")
        return self._post("/v1/moderate/output", {
            "modality": modality,
            "filename": path.name,
            "size_bytes": size,
            "sha256": hashlib.sha256(content).hexdigest(),
            "content_base64": base64.b64encode(content).decode("ascii"),
        })


def moderation_provider_from_env(
    environ: dict[str, str] | None = None,
) -> HTTPSModerationProvider:
    env = os.environ if environ is None else environ
    endpoint = env.get("ASTRA_MODERATION_URL", "")
    token = env.get("ASTRA_MODERATION_TOKEN", "")
    if not endpoint or not token:
        raise ModerationTransportError("MODERATION_CONFIGURATION_MISSING")
    try:
        config = ModerationServiceConfig(
            base_url=endpoint,
            bearer_token=token,
            timeout_seconds=float(env.get("ASTRA_MODERATION_TIMEOUT_SECONDS", "15")),
        )
        return HTTPSModerationProvider(config)
    except (TypeError, ValueError):
        raise ModerationTransportError("MODERATION_CONFIGURATION_INVALID") from None
