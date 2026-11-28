import hmac
import os
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from creative_brief import BriefValidationError, compile_brief
from model_registry import ModelRegistryError, load_catalog_json, route_model
from queue_api import router as queue_router
from worker_api import router as worker_router

app = FastAPI(title="ASTRA Private Model Server", version="0.1.0")
app.include_router(queue_router)
app.include_router(worker_router)


class BriefCompileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    brief: dict


class ModelRouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: StrictStr
    modality: Literal["image", "video"]
    aspect_ratio: Literal["1:1", "9:16", "16:9"]
    width: StrictInt
    height: StrictInt


class ImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task: Literal["image"]
    prompt: str = Field(min_length=5, max_length=1000)
    aspectRatio: Literal["1:1", "9:16", "16:9"]
    output: Literal["base64"]


class VideoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task: Literal["video"]
    prompt: str = Field(min_length=5, max_length=1000)
    aspectRatio: Literal["1:1", "9:16", "16:9"]
    durationSeconds: Literal[5]
    resolution: Literal["480p"]
    output: Literal["https-url"]


def verify_token(authorization: str | None) -> None:
    expected = os.environ.get("ASTRA_MODEL_SERVER_TOKEN", "")
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail="Model server authentication requires a secret of at least 32 characters.")
    supplied = authorization or ""
    if not supplied.startswith("Bearer ") or not hmac.compare_digest(supplied[7:], expected):
        raise HTTPException(status_code=401, detail="Unauthorized.")


def model_is_configured(kind: str) -> bool:
    variable = "ASTRA_" + kind.upper() + "_MODEL_ID"
    return bool(os.environ.get(variable, "").strip())


@app.post("/v1/brief/compile")
def compile_creative_brief(body: BriefCompileRequest, authorization: str | None = Header(default=None)):
    """Validate and assemble a provider-neutral structured brief; no model is called."""
    verify_token(authorization)
    try:
        return compile_brief(body.brief)
    except BriefValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/v1/models/route")
def route_creative_model(body: ModelRouteRequest, authorization: str | None = Header(default=None)):
    """Resolve one explicitly requested catalog model; never fall back silently."""
    verify_token(authorization)
    try:
        catalog = load_catalog_json(os.environ.get("ASTRA_MODEL_CATALOG_JSON", ""))
        return route_model(
            catalog,
            model_id=body.model_id,
            modality=body.modality,
            aspect_ratio=body.aspect_ratio,
            width=body.width,
            height=body.height,
        )
    except ModelRegistryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/health")
def health():
    # Do not expose secrets, filesystem paths, host details, or model internals.
    return {
        "service": "astra-private-model-server",
        "status": "ok",
        "imageModelConfigured": model_is_configured("image"),
        "videoModelConfigured": model_is_configured("video"),
    }


@app.post("/v1/image")
def generate_image(body: ImageRequest, authorization: str | None = Header(default=None)):
    verify_token(authorization)
    if not model_is_configured("image"):
        raise HTTPException(
            status_code=503,
            detail="ASTRA image model runtime is not installed; no generation was attempted.",
        )
    # Deliberately fail closed until a reviewed, licensed model runtime is installed.
    raise HTTPException(status_code=503, detail="ASTRA image runtime adapter is not implemented yet.")


@app.post("/v1/video")
def generate_video(body: VideoRequest, authorization: str | None = Header(default=None)):
    verify_token(authorization)
    if not model_is_configured("video"):
        raise HTTPException(
            status_code=503,
            detail="ASTRA video model runtime is not installed; no generation was attempted.",
        )
    # Deliberately fail closed until a reviewed, licensed model runtime is installed.
    raise HTTPException(status_code=503, detail="ASTRA video runtime adapter is not implemented yet.")
