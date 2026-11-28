"""Private, disabled-by-default worker control API for ASTRA's durable queue."""
from __future__ import annotations

import hmac
import os
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from queue_api import create_store
from queue_store import QueueStoreError

router = APIRouter()


class ClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    worker_id: StrictStr = Field(min_length=1, max_length=100)
    batch_size: StrictInt = Field(default=1, ge=1, le=4)
    lease_seconds: StrictInt = Field(default=120, ge=30, le=600)


class LeaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: StrictStr = Field(min_length=36, max_length=36, pattern=r"^[0-9a-fA-F-]{36}$")
    lease_token: StrictStr = Field(min_length=36, max_length=36, pattern=r"^[0-9a-fA-F-]{36}$")
    lease_seconds: StrictInt = Field(default=120, ge=30, le=600)


class CompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: StrictStr = Field(min_length=36, max_length=36, pattern=r"^[0-9a-fA-F-]{36}$")
    lease_token: StrictStr = Field(min_length=36, max_length=36, pattern=r"^[0-9a-fA-F-]{36}$")
    output_asset: dict


class FailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: StrictStr = Field(min_length=36, max_length=36, pattern=r"^[0-9a-fA-F-]{36}$")
    lease_token: StrictStr = Field(min_length=36, max_length=36, pattern=r"^[0-9a-fA-F-]{36}$")
    error_code: StrictStr = Field(min_length=2, max_length=64, pattern=r"^[A-Z][A-Z0-9_]{1,63}$")
    retryable: StrictBool = False


def _worker_auth(value: str | None) -> None:
    if os.environ.get("ASTRA_WORKER_API_ENABLED", "").strip().lower() != "true":
        raise HTTPException(status_code=503, detail="ASTRA private worker API is disabled.")
    expected = os.environ.get("ASTRA_WORKER_TOKEN", "")
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail="ASTRA worker authentication is not configured.")
    if not value or not hmac.compare_digest(value, expected):
        raise HTTPException(status_code=401, detail="Unauthorized.")


def _store():
    try:
        return create_store()
    except QueueStoreError:
        raise HTTPException(status_code=503, detail="ASTRA private queue storage is not configured.") from None


def _job_id(value: str) -> str:
    from uuid import UUID
    try:
        parsed = UUID(value)
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="Invalid generation job identifier.") from None
    if str(parsed) != value.lower():
        raise HTTPException(status_code=422, detail="Invalid generation job identifier.")
    return str(parsed)


def _lease_token(value: str) -> str:
    from uuid import UUID
    try:
        parsed = UUID(value)
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="Invalid worker lease token.") from None
    if str(parsed) != value.lower():
        raise HTTPException(status_code=422, detail="Invalid worker lease token.")
    return str(parsed)


@router.post("/internal/v1/worker/claim")
def claim_jobs(
    body: ClaimRequest,
    x_astra_worker_token: str | None = Header(default=None),
):
    _worker_auth(x_astra_worker_token)
    try:
        rows = _store().claim_jobs(
            worker_id=body.worker_id,
            batch_size=body.batch_size,
            lease_seconds=body.lease_seconds,
        )
    except QueueStoreError:
        raise HTTPException(status_code=503, detail="ASTRA could not safely claim generation jobs.") from None
    return {
        "jobs": [
            {
                "id": row["id"],
                "user_id": row["user_id"],
                "modality": row["modality"],
                "model_id": row["model_id"],
                "request": row["request"],
                "attempts": row["attempts"],
                "max_attempts": row["max_attempts"],
                "lease_token": row["lease_token"],
                "lease_expires_at": row["lease_expires_at"],
                "cancel_requested": row["cancel_requested"],
            }
            for row in rows
        ]
    }


@router.post("/internal/v1/worker/heartbeat")
def heartbeat_job(
    body: LeaseRequest,
    x_astra_worker_token: str | None = Header(default=None),
):
    _worker_auth(x_astra_worker_token)
    try:
        result = _store().heartbeat(
            job_id=_job_id(body.job_id),
            lease_token=_lease_token(body.lease_token),
            lease_seconds=body.lease_seconds,
        )
    except QueueStoreError:
        raise HTTPException(status_code=503, detail="ASTRA could not safely renew the worker lease.") from None
    if result is None:
        raise HTTPException(status_code=409, detail="Worker lease expired or no longer belongs to this worker.")
    return {
        "job_id": body.job_id,
        "lease_expires_at": result["lease_expires_at"],
        "cancel_requested": result["cancel_requested"],
    }


@router.post("/internal/v1/worker/complete")
def complete_job(
    body: CompleteRequest,
    x_astra_worker_token: str | None = Header(default=None),
):
    _worker_auth(x_astra_worker_token)
    try:
        completed = _store().complete_job(
            job_id=_job_id(body.job_id),
            lease_token=_lease_token(body.lease_token),
            output_asset=body.output_asset,
        )
    except QueueStoreError:
        raise HTTPException(status_code=503, detail="ASTRA could not safely complete this generation job.") from None
    if not completed:
        raise HTTPException(status_code=409, detail="Worker lease expired or the job was cancelled.")
    return {"job_id": body.job_id, "status": "succeeded"}


@router.post("/internal/v1/worker/fail")
def fail_job(
    body: FailRequest,
    x_astra_worker_token: str | None = Header(default=None),
):
    _worker_auth(x_astra_worker_token)
    try:
        status = _store().fail_job(
            job_id=_job_id(body.job_id),
            lease_token=_lease_token(body.lease_token),
            error_code=body.error_code,
            retryable=body.retryable,
        )
    except QueueStoreError:
        raise HTTPException(status_code=503, detail="ASTRA could not safely record the worker failure.") from None
    if status == "lease_lost":
        raise HTTPException(status_code=409, detail="Worker lease expired or no longer belongs to this worker.")
    return {"job_id": body.job_id, "status": status}
