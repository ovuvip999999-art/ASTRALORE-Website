# ASTRA Self-Hosted Generation API

## Goal

ASTRA owns the public generation API and the model-serving contract. The browser calls only the authenticated ASTRA Worker; the Worker calls a private ASTRA model server. Image and video engines can be replaced independently without changing the Studio UI.

This is an API integration foundation, not a trained model or a deployed GPU service. No generation is activated by adding this adapter.

## Request flow

```text
ASTRA Studio
  -> authenticated ASTRA Worker
    -> ASTRA self-hosted model server (private HTTPS endpoint)
      -> ASTRA image model OR ASTRA video model
```

The model server must not be exposed as an unauthenticated public endpoint. Keep its bearer token in a Worker secret named `ASTRA_MODEL_SERVER_TOKEN`; never put it in browser code, Wrangler vars, logs, or repository files.

## Environment configuration

Set these only when an actual private model server exists:

- `ASTRA_IMAGE_PROVIDER=astra-self-hosted`
- `ASTRA_VIDEO_PROVIDER=astra-self-hosted`
- `ASTRA_IMAGE_MODEL_URL=https://<private-host>/v1/image`
- `ASTRA_VIDEO_MODEL_URL=https://<private-host>/v1/video`
- `ASTRA_MODEL_SERVER_TOKEN` as a Worker secret

The provider registry does not select this adapter unless the matching provider ID is explicitly configured. The current Worker-level creative-generation guard still blocks all image and video requests before any adapter can run.

## Image endpoint contract

`POST /v1/image`

Headers:

- `Authorization: Bearer <server-token>`
- `Content-Type: application/json`
- `Accept: application/json`

Body:

```json
{
  "task": "image",
  "prompt": "A quiet nebula",
  "aspectRatio": "16:9",
  "output": "base64"
}
```

Success response:

```json
{
  "imageBase64": "<base64-encoded-image>",
  "mimeType": "image/png",
  "model": "astra-image-model-version"
}
```

Allowed image MIME types: PNG, JPEG, WEBP. The adapter rejects malformed or oversized image data.

## Video endpoint contract

`POST /v1/video`

Headers are the same as the image endpoint.

Body:

```json
{
  "task": "video",
  "prompt": "A comet crossing space",
  "aspectRatio": "16:9",
  "durationSeconds": 5,
  "resolution": "480p",
  "output": "https-url"
}
```

Success response:

```json
{
  "videoUrl": "https://media.example/clip.mp4",
  "model": "astra-video-model-version"
}
```

The adapter accepts only HTTPS output URLs without embedded credentials. The media host must use short-lived signed URLs or equivalent access controls; do not expose private storage buckets.

## Operational requirements before activation

1. Implement the model server and the two endpoint contracts.
2. Use a private network or strict network allowlist where available, TLS, token rotation, request-size limits, authentication, rate limits, and server-side prompt validation.
3. Put expensive inference behind a bounded queue with concurrency limits. Video inference may exceed a normal request lifetime; before production, evolve its endpoint to an asynchronous job contract (`202 + job ID`, followed by authenticated status polling) and update the Studio accordingly.
4. Measure real GPU time, memory, storage, and egress. Self-hosting removes a third-party inference API dependency; it does not make compute or hosting free.
5. Keep a hard server-side spending/resource ceiling. Reject requests when capacity or budget cannot be verified.
6. Test unauthorized access, malformed output, oversized output, provider timeouts, queue saturation, concurrent requests, and model crashes.
7. Keep the Worker fail-closed guard active until the model server, budget controls, and end-to-end tests are complete.

## Current status

- Provider adapter and mocked contract tests are in the repository.
- Added a FastAPI model-server scaffold under `backend/model-server/` with authenticated image/video routes, a health endpoint, Dockerfile, and fail-closed 503 responses until real model runtimes are installed. This scaffold is not deployed.
- No GPU host has been deployed.
- No image/video model weights have been selected, downloaded, trained, or fine-tuned.
- No provider variables or secrets have been configured.
- Image and video generation remain paused.
- No billing changes, database migrations, or deployments are authorized by this design work.
