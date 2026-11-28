"""Authenticated HTTP client for ASTRA's private worker control plane."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

import httpx

ERROR_CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")


class WorkerClientError(RuntimeError):
    """Sanitized private worker API client error."""


@dataclass(frozen=True)
class WorkerClientConfig:
    base_url: str
    token: str

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "WorkerClientConfig":
        import os
        source = os.environ if environ is None else environ
        base_url = source.get("ASTRA_WORKER_API_URL", "").strip().rstrip("/")
        token = source.get("ASTRA_WORKER_TOKEN", "").strip()
        parsed = urlparse(base_url)
        loopback_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
        if (
            (parsed.scheme != "https" and not loopback_http)
            or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
        ):
            raise WorkerClientError("ASTRA_WORKER_API_URL must be HTTPS (loopback HTTP is allowed for local tests).")
        if len(token) < 32 or len(token) > 512:
            raise WorkerClientError("ASTRA_WORKER_TOKEN must contain 32–512 characters.")
        return cls(base_url, token)


class PrivateWorkerClient:
    def __init__(
        self,
        config: WorkerClientConfig,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout_seconds: float = 15.0,
    ) -> None:
        if not 1 <= timeout_seconds <= 60:
            raise WorkerClientError("Worker API timeout must be between 1 and 60 seconds.")
        self.config = config
        self.transport = transport
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def _uuid(value: str, field: str) -> str:
        try:
            parsed = UUID(value)
        except (TypeError, ValueError, AttributeError):
            raise WorkerClientError(f"{field} must be a UUID.") from None
        if str(parsed) != value.lower():
            raise WorkerClientError(f"{field} must be a canonical UUID.")
        return str(parsed)

    def _post(self, path: str, body: dict[str, Any]) -> Any:
        try:
            with httpx.Client(
                timeout=self.timeout_seconds,
                transport=self.transport,
                follow_redirects=False,
            ) as client:
                response = client.post(
                    self.config.base_url + path,
                    headers={
                        "X-ASTRA-Worker-Token": self.config.token,
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
            if response.status_code < 200 or response.status_code >= 300:
                raise WorkerClientError(f"ASTRA worker API rejected the request (HTTP {response.status_code}).")
            return response.json()
        except WorkerClientError:
            raise
        except (httpx.HTTPError, ValueError, TypeError):
            raise WorkerClientError("ASTRA worker API is unavailable or returned invalid JSON.") from None

    def claim(self, *, worker_id: str, batch_size: int = 1, lease_seconds: int = 120) -> list[dict[str, Any]]:
        if not isinstance(worker_id, str) or not 1 <= len(worker_id.strip()) <= 100:
            raise WorkerClientError("worker_id must contain 1–100 characters.")
        if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= 4:
            raise WorkerClientError("batch_size must be between 1 and 4.")
        if isinstance(lease_seconds, bool) or not isinstance(lease_seconds, int) or not 30 <= lease_seconds <= 600:
            raise WorkerClientError("lease_seconds must be between 30 and 600.")
        result = self._post("/internal/v1/worker/claim", {
            "worker_id": worker_id.strip(),
            "batch_size": batch_size,
            "lease_seconds": lease_seconds,
        })
        jobs = result.get("jobs") if isinstance(result, dict) else None
        if not isinstance(jobs, list) or len(jobs) > batch_size or any(not isinstance(job, dict) for job in jobs):
            raise WorkerClientError("ASTRA worker API returned an invalid claim response.")
        for job in jobs:
            self._uuid(job.get("id"), "job_id")
            self._uuid(job.get("lease_token"), "lease_token")
            if job.get("modality") not in {"image", "video"} or not isinstance(job.get("request"), dict):
                raise WorkerClientError("ASTRA worker API returned an invalid claimed job.")
        return jobs

    def heartbeat(self, *, job_id: str, lease_token: str, lease_seconds: int = 120) -> dict[str, Any]:
        job_id = self._uuid(job_id, "job_id")
        lease_token = self._uuid(lease_token, "lease_token")
        if isinstance(lease_seconds, bool) or not isinstance(lease_seconds, int) or not 30 <= lease_seconds <= 600:
            raise WorkerClientError("lease_seconds must be between 30 and 600.")
        result = self._post("/internal/v1/worker/heartbeat", {
            "job_id": job_id,
            "lease_token": lease_token,
            "lease_seconds": lease_seconds,
        })
        if not isinstance(result, dict) or not isinstance(result.get("cancel_requested"), bool):
            raise WorkerClientError("ASTRA worker API returned an invalid heartbeat response.")
        return result

    def complete(self, *, job_id: str, lease_token: str, output_asset: dict[str, Any]) -> bool:
        job_id = self._uuid(job_id, "job_id")
        lease_token = self._uuid(lease_token, "lease_token")
        if not isinstance(output_asset, dict):
            raise WorkerClientError("output_asset must be an object.")
        result = self._post("/internal/v1/worker/complete", {
            "job_id": job_id,
            "lease_token": lease_token,
            "output_asset": output_asset,
        })
        if not isinstance(result, dict) or result.get("status") != "succeeded":
            raise WorkerClientError("ASTRA worker API returned an invalid completion response.")
        return True

    def fail(
        self,
        *,
        job_id: str,
        lease_token: str,
        error_code: str,
        retryable: bool = False,
    ) -> str:
        job_id = self._uuid(job_id, "job_id")
        lease_token = self._uuid(lease_token, "lease_token")
        if not isinstance(error_code, str) or not ERROR_CODE_RE.fullmatch(error_code):
            raise WorkerClientError("error_code must be a safe machine-readable code.")
        if not isinstance(retryable, bool):
            raise WorkerClientError("retryable must be a boolean.")
        result = self._post("/internal/v1/worker/fail", {
            "job_id": job_id,
            "lease_token": lease_token,
            "error_code": error_code,
            "retryable": retryable,
        })
        if not isinstance(result, dict) or result.get("status") not in {"queued", "failed", "cancelled"}:
            raise WorkerClientError("ASTRA worker API returned an invalid failure response.")
        return result["status"]
