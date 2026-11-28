"""Authenticated HTTP surface for ASTRA's durable queue.

All routes are disabled by default. Requests require both the private Worker-to-
server secret and a user Supabase access token. User identity is always resolved
through Supabase Auth; callers cannot submit an arbitrary owner UUID.
"""
from __future__ import annotations

import hmac
import os
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from creative_brief import BriefValidationError, compile_brief
from model_registry import ModelRegistryError, load_catalog_json, route_model
from queue_store import QueueStoreError, SupabaseQueueConfig, SupabaseQueueStore

router = APIRouter()


class CreateJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    modality: Literal["image", "video"]
    model_id: StrictStr = Field(min_length=2, max_length=128)
    aspect_ratio: Literal["1:1", "9:16", "16:9"]
    width: StrictInt = Field(gt=0, le=16384)
    height: StrictInt = Field(gt=0, le=16384)
    brief: dict
    idempotency_key: StrictStr = Field(min_length=8, max_length=128)


def create_store() -> SupabaseQueueStore:
    return SupabaseQueueStore(SupabaseQueueConfig.from_env())


def _require_enabled() -> None:
    if os.environ.get("ASTRA_QUEUE_API_ENABLED", "").strip().lower() != "true":
        raise HTTPException(status_code=503, detail="ASTRA queue API is disabled.")


def _verify_internal_secret(value: str | None) -> None:
    expected = os.environ.get("ASTRA_MODEL_SERVER_TOKEN", "")
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail="Private ASTRA server authentication is not configured.")
    if not value or not hmac.compare_digest(value, expected):
        raise HTTPException(status_code=401, detail="Unauthorized.")


def _user_access_token(value: str | None) -> str:
    if not isinstance(value, str) or not value.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="A signed-in ASTRA user session is required.")
    token = value[7:].strip()
    if not 20 <= len(token) <= 8192:
        raise HTTPException(status_code=401, detail="A valid ASTRA user session is required.")
    return token


def _authenticated_store(
    internal_secret: str | None,
    authorization: str | None,
) -> tuple[SupabaseQueueStore, str, str]:
    _require_enabled()
    _verify_internal_secret(internal_secret)
    access_token = _user_access_token(authorization)
    try:
        store = create_store()
        user_id = store.verify_user_access_token(access_token)
    except QueueStoreError:
        raise HTTPException(status_code=401, detail="The ASTRA user session could not be verified.") from None
    return store, user_id, access_token


@router.post("/v1/jobs", status_code=202)
def create_generation_job(
    body: CreateJobRequest,
    x_astra_server_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    store, user_id, _ = _authenticated_store(x_astra_server_token, authorization)

    try:
        compiled = compile_brief(body.brief)
        normalized = compiled["brief"]
        if normalized["modality"] != body.modality or normalized["aspect_ratio"] != body.aspect_ratio:
            raise HTTPException(status_code=422, detail="Job settings must match the structured creative brief.")
        catalog = load_catalog_json(os.environ.get("ASTRA_MODEL_CATALOG_JSON", ""))
        route = route_model(
            catalog,
            model_id=body.model_id,
            modality=body.modality,
            aspect_ratio=body.aspect_ratio,
            width=body.width,
            height=body.height,
        )
    except BriefValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ModelRegistryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    job_request = {
        "brief": normalized,
        "compiled_prompt": compiled["compiled_prompt"],
        "brief_sha256": compiled["brief_sha256"],
        "schema_version": compiled["schema_version"],
        "width": body.width,
        "height": body.height,
        "aspect_ratio": body.aspect_ratio,
        "model_revision": route["revision"],
    }
    try:
        job = store.enqueue_job(
            user_id=user_id,
            modality=body.modality,
            model_id=body.model_id,
            request=job_request,
            idempotency_key=body.idempotency_key,
        )
    except QueueStoreError:
        raise HTTPException(status_code=503, detail="ASTRA could not safely accept this generation job.") from None

    return {
        "job_id": str(job["id"]),
        "status": job["status"],
        "modality": job["modality"],
        "model_id": job["model_id"],
        "created_at": job["created_at"],
    }


@router.get("/v1/jobs/{job_id}")
def get_generation_job(
    job_id: str,
    x_astra_server_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    store, _, access_token = _authenticated_store(x_astra_server_token, authorization)
    try:
        job = store.get_user_job(job_id=job_id, access_token=access_token)
    except QueueStoreError:
        raise HTTPException(status_code=422, detail="Invalid generation job identifier or lookup request.") from None
    if job is None:
        raise HTTPException(status_code=404, detail="Generation job not found.")
    return job


@router.post("/v1/jobs/{job_id}/cancel")
def cancel_generation_job(
    job_id: str,
    x_astra_server_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    store, _, access_token = _authenticated_store(x_astra_server_token, authorization)
    try:
        status = store.cancel_user_job(job_id=job_id, access_token=access_token)
    except QueueStoreError:
        raise HTTPException(status_code=422, detail="Invalid generation job identifier or cancellation request.") from None
    return {"job_id": job_id, "status": status}
