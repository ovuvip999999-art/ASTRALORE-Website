import hmac
import os
import re
from typing import Literal
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="ASTRA Private Model Server", version="0.1.0")

IMAGE_RATIOS = {"1:1", "9:16", "16:9"}
VIDEO_RATIOS = {"1:1", "9:16", "16:9"}
IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}


class ImageRequest(BaseModel):
    task: Literal["image"]
    prompt: str = Field(min_length=5, max_length=1000)
    aspectRatio: Literal["1:1", "9:16", "16:9"]
    output: Literal["base64"]


class VideoRequest(BaseModel):
    task: Literal["video"]
    prompt: str = Field(min_length=5, max_length=1000)
    aspectRatio: Literal["1:1", "9:16", "16:9"]
    durationSeconds: Literal[5]
    resolution: Literal["480p"]
    output: Literal["https-url"]


def verify_token(authorization: str | None) -> None:
    expected = os.environ.get("ASTRA_MODEL_SERVER_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Model server authentication is not configured.")
    supplied = authorization or ""
    if not supplied.startswith("Bearer ") or not hmac.compare_digest(supplied[7:], expected):
        raise HTTPException(status_code=401, detail="Unauthorized.")


def model_is_configured(kind: str) -> bool:
    variable = "ASTRA_" + kind.upper() + "_MODEL_ID"
    return bool(os.environ.get(variable, "").strip())


@app.get("/health")
def health():
    # Do not expose secrets, filesystem paths, host details, or model internals.
    return {
        "service": "astra-private-model-server",
        "status": "ok",
        "imageModelReady": model_is_configured("image"),
        "videoModelReady": model_is_configured("video"),
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
