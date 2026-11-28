"""Private Supabase REST adapter for ASTRA's durable generation queue.

All service-role operations are server-side only. End-user reads/cancellation
use the caller's Supabase access token so Postgres RLS and auth.uid() apply.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")


class QueueStoreError(RuntimeError):
    """Sanitized queue-store error; never includes credentials or raw response text."""


@dataclass(frozen=True)
class SupabaseQueueConfig:
    url: str
    anon_key: str
    service_role_key: str

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "SupabaseQueueConfig":
        import os

        source = os.environ if environ is None else environ
        url = source.get("SUPABASE_URL", "").strip().rstrip("/")
        anon = source.get("SUPABASE_ANON_KEY", "").strip()
        service = source.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        parsed = urlparse(url)
        local_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
        if (parsed.scheme != "https" and not local_http) or not parsed.hostname or parsed.username or parsed.password:
            raise QueueStoreError("SUPABASE_URL must be an HTTPS URL (loopback HTTP is allowed for local tests).")
        if not anon or not service:
            raise QueueStoreError("Supabase anon and service-role keys must be configured server-side.")
        if len(anon) < 24 or len(service) < 24:
            raise QueueStoreError("Supabase keys do not meet the minimum length requirement.")
        return cls(url=url, anon_key=anon, service_role_key=service)


class SupabaseQueueStore:
    def __init__(
        self,
        config: SupabaseQueueConfig,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        if not 1 <= timeout_seconds <= 30:
            raise QueueStoreError("Queue-store timeout must be between 1 and 30 seconds.")
        self.config = config
        self.timeout_seconds = timeout_seconds
        self.transport = transport

    @staticmethod
    def _uuid(value: str, field: str) -> str:
        if not isinstance(value, str) or not UUID_RE.fullmatch(value):
            raise QueueStoreError(f"{field} must be a UUID.")
        return value

    def _call(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
        user_access_token: str | None = None,
    ) -> Any:
        key = self.config.anon_key if user_access_token else self.config.service_role_key
        bearer = user_access_token if user_access_token else self.config.service_role_key
        headers = {
            "apikey": key,
            "Authorization": "Bearer " + bearer,
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        try:
            with httpx.Client(
                timeout=self.timeout_seconds,
                transport=self.transport,
                follow_redirects=False,
            ) as client:
                response = client.request(
                    method,
                    self.config.url + path,
                    headers=headers,
                    json=body,
                    params=params,
                )
            if response.status_code < 200 or response.status_code >= 300:
                raise QueueStoreError(f"Supabase queue request failed with HTTP {response.status_code}.")
            if not response.content:
                return None
            return response.json()
        except QueueStoreError:
            raise
        except (httpx.HTTPError, ValueError):
            raise QueueStoreError("Supabase queue service is unavailable or returned invalid JSON.") from None

    def verify_user_access_token(self, access_token: str) -> str:
        if not isinstance(access_token, str) or len(access_token) < 20 or len(access_token) > 8192:
            raise QueueStoreError("A valid user access token is required.")
        result = self._call(
            "GET",
            "/auth/v1/user",
            user_access_token=access_token,
        )
        if not isinstance(result, dict):
            raise QueueStoreError("Supabase did not return a valid authenticated user.")
        user_id = result.get("id")
        return self._uuid(user_id, "authenticated user id")

    def enqueue_job(
        self,
        *,
        user_id: str,
        modality: str,
        model_id: str,
        request: dict[str, Any],
        idempotency_key: str,
    ) -> dict[str, Any]:
        self._uuid(user_id, "user_id")
        if modality not in {"image", "video"}:
            raise QueueStoreError("modality must be image or video.")
        if not isinstance(model_id, str) or not 1 <= len(model_id.strip()) <= 128:
            raise QueueStoreError("model_id must contain 1–128 characters.")
        if not isinstance(request, dict) or len(str(request).encode("utf-8")) > 32768:
            raise QueueStoreError("request must be an object no larger than 32 KiB.")
        if not isinstance(idempotency_key, str) or not 8 <= len(idempotency_key) <= 128:
            raise QueueStoreError("idempotency_key must contain 8–128 characters.")
        result = self._call("POST", "/rest/v1/rpc/astra_enqueue_generation_job", body={
            "p_user_id": user_id,
            "p_modality": modality,
            "p_model_id": model_id.strip(),
            "p_request": request,
            "p_idempotency_key": idempotency_key,
        })
        if not isinstance(result, dict) or not result.get("id"):
            raise QueueStoreError("Supabase returned an invalid generation job record.")
        return result

    def claim_jobs(self, *, worker_id: str, batch_size: int = 1, lease_seconds: int = 120) -> list[dict[str, Any]]:
        if not isinstance(worker_id, str) or not 1 <= len(worker_id.strip()) <= 100:
            raise QueueStoreError("worker_id must contain 1–100 characters.")
        if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= 4:
            raise QueueStoreError("batch_size must be between 1 and 4.")
        if isinstance(lease_seconds, bool) or not isinstance(lease_seconds, int) or not 30 <= lease_seconds <= 600:
            raise QueueStoreError("lease_seconds must be between 30 and 600.")
        result = self._call("POST", "/rest/v1/rpc/astra_claim_generation_jobs", body={
            "p_worker_id": worker_id.strip(),
            "p_batch_size": batch_size,
            "p_lease_seconds": lease_seconds,
        })
        if not isinstance(result, list) or any(not isinstance(row, dict) for row in result):
            raise QueueStoreError("Supabase returned an invalid job claim response.")
        return result

    def heartbeat(self, *, job_id: str, lease_token: str, lease_seconds: int = 120) -> dict[str, Any] | None:
        self._uuid(job_id, "job_id")
        self._uuid(lease_token, "lease_token")
        if isinstance(lease_seconds, bool) or not isinstance(lease_seconds, int) or not 30 <= lease_seconds <= 600:
            raise QueueStoreError("lease_seconds must be between 30 and 600.")
        result = self._call("POST", "/rest/v1/rpc/astra_heartbeat_generation_job", body={
            "p_job_id": job_id,
            "p_lease_token": lease_token,
            "p_lease_seconds": lease_seconds,
        })
        if not isinstance(result, list) or len(result) > 1:
            raise QueueStoreError("Supabase returned an invalid heartbeat response.")
        return result[0] if result else None

    def complete_job(self, *, job_id: str, lease_token: str, output_asset: dict[str, Any]) -> bool:
        self._uuid(job_id, "job_id")
        self._uuid(lease_token, "lease_token")
        if not isinstance(output_asset, dict):
            raise QueueStoreError("output_asset must be an object.")
        result = self._call("POST", "/rest/v1/rpc/astra_complete_generation_job", body={
            "p_job_id": job_id,
            "p_lease_token": lease_token,
            "p_output_asset": output_asset,
        })
        if not isinstance(result, bool):
            raise QueueStoreError("Supabase returned an invalid completion response.")
        return result

    def fail_job(
        self,
        *,
        job_id: str,
        lease_token: str,
        error_code: str,
        retryable: bool = False,
    ) -> str:
        self._uuid(job_id, "job_id")
        self._uuid(lease_token, "lease_token")
        if not isinstance(error_code, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,63}", error_code):
            raise QueueStoreError("error_code must be a safe machine-readable code.")
        if not isinstance(retryable, bool):
            raise QueueStoreError("retryable must be a boolean.")
        result = self._call("POST", "/rest/v1/rpc/astra_fail_generation_job", body={
            "p_job_id": job_id,
            "p_lease_token": lease_token,
            "p_error_code": error_code,
            "p_retryable": retryable,
        })
        if result not in {"queued", "failed", "cancelled", "lease_lost"}:
            raise QueueStoreError("Supabase returned an invalid failure transition.")
        return result

    def get_user_job(self, *, job_id: str, access_token: str) -> dict[str, Any] | None:
        self._uuid(job_id, "job_id")
        if not isinstance(access_token, str) or len(access_token) < 20 or len(access_token) > 8192:
            raise QueueStoreError("A valid user access token is required.")
        result = self._call(
            "GET",
            "/rest/v1/astra_generation_jobs",
            params={"id": "eq." + job_id, "select": "id,modality,model_id,status,output_asset,error_code,created_at,updated_at,completed_at"},
            user_access_token=access_token,
        )
        if not isinstance(result, list) or len(result) > 1:
            raise QueueStoreError("Supabase returned an invalid job lookup response.")
        return result[0] if result else None

    def cancel_user_job(self, *, job_id: str, access_token: str) -> str:
        self._uuid(job_id, "job_id")
        if not isinstance(access_token, str) or len(access_token) < 20 or len(access_token) > 8192:
            raise QueueStoreError("A valid user access token is required.")
        result = self._call(
            "POST",
            "/rest/v1/rpc/astra_cancel_generation_job",
            body={"p_job_id": job_id},
            user_access_token=access_token,
        )
        if result not in {"cancelled", "cancellation_requested", "queued", "running", "succeeded", "failed"}:
            raise QueueStoreError("Supabase returned an invalid cancellation response.")
        return result
