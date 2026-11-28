# ASTRA Private Model Server — scaffold

This is the first deployable API-server scaffold for ASTRA's self-hosted image/video engines. It is **not an image or video model** and does not perform inference yet.

## Endpoints

- `GET /health`: reports whether model IDs are configured, without revealing secrets.
- `POST /v1/image`: authenticated image request using the contract in `backend/ASTRA-SELF-HOSTED-GENERATION-API.md`.
- `POST /v1/video`: authenticated 5-second, 480p video request using the same contract.

Both generation routes intentionally return HTTP 503. This is fail-closed behavior until a model runtime is selected, installed, license-reviewed, and tested. Setting a model ID alone does not enable generation.

## Local development

Requires Python 3.12+.

```bash
python -m venv .venv
# Windows:
.venv\\Scripts\\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
```

Set a development-only random token of at least 32 characters in the shell, then start the API:

```bash
# PowerShell
$env:ASTRA_MODEL_SERVER_TOKEN = "replace-with-a-long-random-development-secret"
uvicorn app:app --host 127.0.0.1 --port 8000
```

Health check: `http://127.0.0.1:8000/health`.

For a local-only test, bind to loopback as above. Do not expose this service publicly until TLS termination, network restrictions, secret management, rate limiting, request limits, monitoring, and GPU resource caps are configured.

## Runtime selection

The server currently has no model dependencies or weights. Before adding them:

1. Compare candidate image and video models for GPU VRAM, inference speed, quality, and commercial-use license.
2. Pick model versions and pin dependencies/weights by immutable version or checksum.
3. Implement a dedicated inference adapter for each model; do not load untrusted model files.
4. Add queue limits, timeouts, cancellation, concurrency caps, and output storage controls.
5. Add tests with tiny fixtures and mock inference before downloading large weights.
6. Measure GPU hours, storage, and bandwidth. Self-hosting avoids a third-party generation API, not infrastructure costs.

Do not configure the ASTRA Worker to call this server until it is deployed privately and the integration has passed end-to-end tests. The Worker-level generation pause remains active.


## Quality benchmark harness

ASTRA includes a deterministic, human-rating benchmark tool:

- `benchmark_prompts.jsonl`: initial shared prompt pack for image and video tasks.
- `quality_eval.py`: validates generation metadata and blinded reviewer scores, then calculates modality-specific weighted quality summaries.
- `test_quality_eval.py`: unit tests for scoring, video-specific temporal criteria, duplicate ratings, unknown samples, and invalid metadata.

Example (after producing benchmark outputs and collecting blinded reviewer ratings):

```bash
python quality_eval.py --runs runs.jsonl --ratings ratings.jsonl --output report.json
```

The run manifest and rating file are JSONL: one JSON object per line. Run metadata records the model revision, runtime version, seed, dimensions, generation time, peak VRAM, and output SHA-256. Ratings use a blind model label and integer scores from 1–5. Image and video use separate rubrics; video explicitly scores temporal coherence and motion quality.

The evaluator does not generate media, anonymize files, or claim statistical significance. Keep the prompt set, generation settings, and review process consistent when comparing models. Do not put private media URLs, user secrets, or personal data in benchmark manifests.

## Creative Brief Compiler

ASTRA also exposes an authenticated, provider-neutral structured brief endpoint:

- `POST /v1/brief/compile` with JSON body `{"brief": {"prompt": "...", "modality": "image"}}`.
- Optional fields: `aspect_ratio`, `style`, `subjects`, `environment`, `composition`, `camera`, `lighting`, `motion` (video only), and `negative_constraints`.
- The response includes a normalized brief, deterministic compiled prompt, schema version, and SHA-256 fingerprint.
- Unknown fields, invalid modality/ratio, duplicate list entries, and overlong values are rejected.
- The original user prompt remains first. The compiler adds only explicitly supplied fields and does not invent scene details.

This is a deterministic structured-input compiler, not an LLM parser or a guarantee of better model output. It does not call a generation model and can be tested without GPU hardware.

Example:

```json
{
  "brief": {
    "prompt": "A lone explorer at the edge of an ancient observatory",
    "modality": "image",
    "aspect_ratio": "16:9",
    "style": "hand-painted cinematic illustration",
    "lighting": "warm light from a low sun",
    "composition": "wide establishing shot"
  }
}
```

## Explicit model capability registry

ASTRA includes a server-configured model catalog and authenticated `POST /v1/models/route` preflight endpoint.

- Configure `ASTRA_MODEL_CATALOG_JSON` only in the private model-server environment.
- Each catalog entry declares a pinned model ID/revision, provider, supported modalities and aspect ratios, maximum dimensions/pixels, minimum VRAM declaration, and enabled state.
- A route request must name an exact model ID. Unknown or disabled models are rejected; there is no automatic model fallback.
- Modality, ratio, dimensions, and pixel bounds are validated before a route descriptor is returned.
- The response exposes only capability metadata, not local paths or credentials.

This is a capability/preflight decision, not proof that a GPU is available. The eventual inference worker must measure actual free VRAM and enforce concurrency/resource limits immediately before loading or running a model. No model is enabled by default, and no weights are installed by this registry.

## Generation job lifecycle contract

`job_lifecycle.py` defines the storage-neutral state machine for future asynchronous image/video jobs:

- States: `queued`, `running`, `succeeded`, `failed`, `cancelled`.
- Legal transitions are explicit; terminal states cannot be reopened.
- Duplicate same-state transitions are idempotent.
- Timestamps must be timezone-aware and monotonic.
- Successful jobs require validated output metadata, including MIME type, dimensions (maximum 16K per side / 100 megapixels), bounded size (512 MiB), and SHA-256; video also requires a bounded duration.
- Failed jobs expose only a safe machine-readable error code, not raw exception text or filesystem paths.

This is a pure contract and validator, not a durable queue or API endpoint. Production requires a transactional database/queue, ownership checks, atomic claims, worker leases, retry policy, cancellation signaling, and concurrency/resource limits. An in-memory queue must not be used as a production substitute.

## HTTP integration tests

Install test dependencies with `pip install -r requirements-dev.txt`. The CI suite uses FastAPI's TestClient to exercise actual HTTP routing, bearer authentication, brief compilation, model-catalog routing, schema rejection, health output, and the intentionally disabled image/video inference endpoints. CI also starts an isolated PostgreSQL 16 service and executes migration 0010 against it, testing queue admission/idempotency, atomic claims, leases, retries, completion validation, owner RLS, cancellation, and concurrent worker claims. The generation endpoints are expected to return HTTP 503 until reviewed runtimes are installed.

### Run the checks on Windows

From PowerShell, inside `backend/model-server`:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\run-tests.ps1
```

The script creates a local `.venv`, installs only the API/test dependencies, compiles the modules, and runs the complete unit/HTTP suite. It does not download model weights, use a GPU, call a paid API, or enable generation.

## Durable generation queue foundation (migration 0010)

The next queue milestone is scaffolded but **not yet active**:

- `backend/migrations/0010_astra_generation_jobs.sql` defines a private, owner-scoped job table and atomic Postgres RPCs.
- Admission is bounded to at most 2 active jobs per user and 100 active jobs globally; idempotency keys prevent duplicate submissions.
- Workers claim with `FOR UPDATE SKIP LOCKED`, short leases, unique lease tokens, heartbeats, bounded retries, and lease-expiry recovery.
- Users can read only their own job rows through RLS and request cancellation; running jobs receive a cooperative cancellation flag.
- Worker-only RPCs are granted to `service_role`; user cancellation checks `auth.uid()`.
- Output metadata has MIME, digest, dimensions, byte-size, and video-duration checks. The database cannot inspect the actual media bytes; the future worker must validate bytes/container before calling completion.
- `queue_store.py` is a server-side Supabase REST adapter. It keeps the service-role key server-only, verifies user access tokens through Supabase Auth, and uses the user's token for RLS-protected reads/cancellation.
- Unit tests use mocked HTTP; migration contract tests check the security and queue invariants; CI also starts an ephemeral PostgreSQL 16 service and executes the migration plus real queue/RLS/lease/concurrency integration tests.

**Important:** migration 0010 is a new SQL file only. It has NOT been applied to Supabase. Do not apply migrations 0008 or 0009. The queue adapter is not wired to public API endpoints, there is no worker process, and generation remains blocked. No database, Worker, or production deployment has been performed.

### Authenticated job API (disabled by default)

The private FastAPI server now mounts these routes:

- `POST /v1/jobs`: verifies the private Worker-to-server secret and the user's Supabase access token, derives the owner UUID from Supabase Auth (never from request JSON), compiles the structured brief, validates the exact enabled model against the server catalog, and submits an idempotent job.
- `GET /v1/jobs/{job_id}`: returns a job only when Supabase RLS makes it visible to the caller.
- `POST /v1/jobs/{job_id}/cancel`: calls the owner-checked cancellation RPC using the user's own access token.

All three routes require `ASTRA_QUEUE_API_ENABLED=true`, a server-only `ASTRA_MODEL_SERVER_TOKEN` of at least 32 characters, and a valid user session. The queue API flag is unset/false by default. The private API is not yet wired to the Cloudflare Worker, and no queue worker is running. There are intentionally no public worker-claim or completion endpoints yet.
