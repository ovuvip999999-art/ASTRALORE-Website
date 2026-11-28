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
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, model_validator

from asset_store import AssetStoreConfig, AssetStoreError, SupabasePrivateAssetStore
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
    duration_seconds: StrictInt | None = None

    @model_validator(mode="after")
    def validate_duration(self):
        if self.modality == "video":
            if self.duration_seconds is None:
                self.duration_seconds = 5
            if not 1 <= self.duration_seconds <= 120:
                raise ValueError("Video duration must be between 1 and 120 seconds.")
        elif self.duration_seconds is not None:
            raise ValueError("Image jobs cannot specify a video duration.")
        return self


def create_store() -> SupabaseQueueStore:
    return SupabaseQueueStore(SupabaseQueueConfig.from_env())


def create_asset_store() -> SupabasePrivateAssetStore:
    return SupabasePrivateAssetStore(AssetStoreConfig.from_env())


def _require_enabled(request_origin: str) -> None:
    if os.environ.get("ASTRA_QUEUE_API_ENABLED", "").strip().lower() != "true":
        raise HTTPException(status_code=503, detail="ASTRA queue API is disabled.")
    origin_flag = "ASTRA_PUBLIC_QUEUE_API_ENABLED" if request_origin == "public" else "ASTRA_INTERNAL_QUEUE_API_ENABLED"
    if os.environ.get(origin_flag, "").strip().lower() != "true":
        raise HTTPException(status_code=503, detail="ASTRA queue access mode is disabled.")


def _require_generation_ready() -> None:
    required_flags = (
        "ASTRA_MODEL_RUNTIME_READY",
        "ASTRA_MODERATION_READY",
        "ASTRA_WORKER_API_ENABLED",
        "ASTRA_WORKER_PROCESS_READY",
        "ASTRA_CREATIVE_GENERATION_APPROVED",
        "ASTRA_COST_POLICY_APPROVED",
    )
    if any(os.environ.get(flag, "").strip().lower() != "true" for flag in required_flags):
        raise HTTPException(status_code=503, detail="ASTRA generation readiness and owner approvals are incomplete.")


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
    request_origin: str,
) -> tuple[SupabaseQueueStore, str, str]:
    _require_enabled(request_origin)
    _verify_internal_secret(internal_secret)
    access_token = _user_access_token(authorization)
    try:
        store = create_store()
    except QueueStoreError:
        raise HTTPException(status_code=503, detail="ASTRA queue storage is not configured.") from None
    try:
        user_id = store.verify_user_access_token(access_token)
    except QueueStoreError:
        raise HTTPException(status_code=401, detail="The ASTRA user session could not be verified.") from None
    return store, user_id, access_token


@router.post("/v1/jobs", status_code=202)
@router.post("/v1/{request_origin}/jobs", status_code=202)
def create_generation_job(
    body: CreateJobRequest,
    request_origin: str = "internal",
    x_astra_server_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    if request_origin not in {"internal", "public"}:
        raise HTTPException(status_code=404, detail="Generation route not found.")
    store, user_id, _ = _authenticated_store(x_astra_server_token, authorization, request_origin)
    _require_generation_ready()

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
        "duration_seconds": body.duration_seconds,
    }
    try:
        job = store.enqueue_job(
            user_id=user_id,
            modality=body.modality,
            model_id=body.model_id,
            request=job_request,
            idempotency_key=body.idempotency_key,
            request_origin=request_origin,
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
@router.get("/v1/{request_origin}/jobs/{job_id}")
def get_generation_job(
    job_id: str,
    request_origin: str = "internal",
    x_astra_server_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    if request_origin not in {"internal", "public"}:
        raise HTTPException(status_code=404, detail="Generation route not found.")
    store, _, access_token = _authenticated_store(x_astra_server_token, authorization, request_origin)
    try:
        job = store.get_user_job(job_id=job_id, access_token=access_token)
    except QueueStoreError:
        raise HTTPException(status_code=422, detail="Invalid generation job identifier or lookup request.") from None
    if job is None or job.get("request_origin", "internal") != request_origin:
        raise HTTPException(status_code=404, detail="Generation job not found.")
    return job


@router.post("/v1/jobs/{job_id}/cancel")
@router.post("/v1/{request_origin}/jobs/{job_id}/cancel")
def cancel_generation_job(
    job_id: str,
    request_origin: str = "internal",
    x_astra_server_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    if request_origin not in {"internal", "public"}:
        raise HTTPException(status_code=404, detail="Generation route not found.")
    store, _, access_token = _authenticated_store(x_astra_server_token, authorization, request_origin)
    try:
        visible_job = store.get_user_job(job_id=job_id, access_token=access_token)
        if visible_job is None or visible_job.get("request_origin", "internal") != request_origin:
            raise HTTPException(status_code=404, detail="Generation job not found.")
        status = store.cancel_user_job(job_id=job_id, access_token=access_token)
    except QueueStoreError:
        raise HTTPException(status_code=422, detail="Invalid generation job identifier or cancellation request.") from None
    return {"job_id": job_id, "status": status}

@router.get("/v1/jobs/{job_id}/asset-url")
@router.get("/v1/{request_origin}/jobs/{job_id}/asset-url")
def get_generation_asset_url(
    job_id: str,
    request_origin: str = "internal",
    x_astra_server_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    if request_origin not in {"internal", "public"}:
        raise HTTPException(status_code=404, detail="Generation route not found.")
    store, user_id, access_token = _authenticated_store(x_astra_server_token, authorization, request_origin)
    try:
        canonical_job_id = store._uuid(job_id, "job_id")
        job = store.get_user_job(job_id=canonical_job_id, access_token=access_token)
    except QueueStoreError:
        raise HTTPException(status_code=422, detail="Invalid generation job identifier or lookup request.") from None
    if job is None or job.get("request_origin", "internal") != request_origin:
        raise HTTPException(status_code=404, detail="Generation job not found.")
    if job.get("status") != "succeeded":
        raise HTTPException(status_code=409, detail="Generation job has no completed asset.")
    output_asset = job.get("output_asset")
    if not isinstance(output_asset, dict):
        raise HTTPException(status_code=404, detail="Generation asset not found.")
    try:
        expected_path = SupabasePrivateAssetStore._object_path(user_id, canonical_job_id, output_asset)
    except AssetStoreError:
        raise HTTPException(status_code=404, detail="Generation asset not found.") from None
    if output_asset.get("storage_path") != expected_path:
        raise HTTPException(status_code=404, detail="Generation asset not found.")
    try:
        signed_url = create_asset_store().create_signed_url(expected_path, expires_in=60)
    except AssetStoreError:
        raise HTTPException(status_code=503, detail="ASTRA could not safely create a private asset link.") from None
    return {
        "job_id": canonical_job_id,
        "url": signed_url,
        "expires_in": 60,
    }

