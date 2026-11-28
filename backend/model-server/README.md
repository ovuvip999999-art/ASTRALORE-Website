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

## Actual media-byte validation foundation

- `media_validation.py` inspects only local files inside a worker-owned output directory; it never fetches URLs and never invokes a shell.
- Images are identified from their actual bytes, structurally verified, and fully decoded with Pillow (PNG/JPEG/WebP only).
- Videos are inspected with local `ffprobe`, restricted to `file,pipe` protocols, with a timeout and bounded JSON output (MP4/WebM only).
- Both modalities get a SHA-256 computed from the actual file bytes. File identity/size/mtime are compared before and after inspection to detect mutation during validation.
- Worker inspection limits: 512 MiB file size, 16K maximum side, 40 megapixels, and 120 seconds for video. The 40 MP worker ceiling is intentionally stricter than the database's 100 MP metadata ceiling to limit decode memory.
- Unit tests use real generated PNG/JPEG/WebP fixtures and mocked ffprobe results/failures.

This validator is not yet called by a generation worker because no worker or model runtime exists. The future worker must run media inspection in a restricted process/container, then upload validated bytes to private storage, and only then call the database completion RPC. No model generation or deployment is enabled.

## Private generated-media storage foundation (migration 0011)

ASTRA now has a server-only storage path for future validated generation outputs:

- Migration `0011_astra_private_generated_assets.sql` creates the `astra-generated-private` Supabase Storage bucket with public access disabled, a 512 MiB object limit, and PNG/JPEG/WebP/MP4/WebM MIME allowlist.
- A restrictive Storage RLS policy prevents any broader permissive `anon` or `authenticated` policy from granting access to this bucket. The private worker uses the server-side `service_role` credential.
- `asset_store.py` streams validated local files to Storage; it does not buffer full media files in memory, create public/signed URLs, or expose the service-role credential to clients.
- Object keys are deterministic owner/job/asset partitions: `{user_uuid}/{job_uuid}/{asset_uuid}.{extension}`.
- The adapter rechecks file identity, size, and SHA-256 while streaming. It uses `x-upsert: false`; an object conflict never triggers deletion of the pre-existing object.
- Migration 0010's completion RPC now requires the storage path to match the job owner, job ID, asset ID, and MIME extension before accepting success.
- Unit tests cover streaming, private headers/path, file mutation, digest mismatch cleanup, path traversal, and conflict safety. PostgreSQL CI simulates a broad permissive Storage policy and verifies the restrictive rule still blocks this bucket.

Migrations 0010 and 0011 are source files only and have NOT been applied to Supabase. There is no worker, Worker integration, signed-download endpoint, or generation runtime yet. Generation remains disabled.

## Private worker control plane

The model server now mounts a separate internal worker API:

- `POST /internal/v1/worker/claim`: atomically claims a bounded batch and returns job data plus lease tokens.
- `POST /internal/v1/worker/heartbeat`: renews a lease and reports cooperative cancellation.
- `POST /internal/v1/worker/complete`: completes only with the current lease and output metadata; the database validates the owner/job-scoped private storage path.
- `POST /internal/v1/worker/fail`: records a safe machine-readable error code and bounded retry decision.

Every route requires `ASTRA_WORKER_API_ENABLED=true` and a separate `ASTRA_WORKER_TOKEN` of at least 32 characters, compared in constant time. The worker token is distinct from the Worker-to-server token. The API is disabled by default and is intended for private server-to-server traffic only; it is not a browser API. There is still no polling worker process, inference runtime, or deployed private network. Never enable this flag on a publicly reachable server.

### Owner-authorized private asset retrieval

- `GET /v1/jobs/{job_id}/asset-url` uses the caller's verified Supabase session and RLS-scoped job lookup.
- It returns a 60-second signed URL only for a succeeded job whose stored object path exactly matches the authenticated user UUID, job UUID, asset UUID and MIME-derived extension.
- The server validates the signed URL response as a relative URL for the exact private bucket/object; it never accepts or returns an arbitrary external URL.
- The Storage bucket remains private. Signed URLs are bearer links and should not be logged or shared; no long-lived/public URL is created.

The route is part of the authenticated queue API and remains disabled by default with `ASTRA_QUEUE_API_ENABLED` unset/false.

## Fail-closed worker orchestration foundation

- `worker_client.py` is the authenticated client for the private worker API; it validates claim/lease responses and distinguishes confirmed HTTP 409 lease loss from ambiguous transport failures.
- `worker_runner.py` provides a testable orchestration loop: exact `(model_id, model_revision)` adapter lookup, heartbeat renewal, cooperative cancellation, actual media validation, requested-dimension checks, private asset upload, and lease-scoped completion/failure.
- The runner refuses to claim any jobs when its adapter map is empty. There are currently no installed or registered inference adapters, so this code cannot generate media.
- A confirmed lost lease after upload causes cleanup of the uncommitted private object. An ambiguous completion network failure does not delete the object, because the database may already have committed; orphan cleanup will require a later reconciler.
- The runner is a library foundation, not a deployed daemon. OS/container-level CPU, RAM, disk, GPU, and wall-clock limits plus process isolation are still required before running untrusted/model code.
- Added mocked adapter tests for no-adapter fail-closed behavior, exact revision matching, successful image pipeline, dimension mismatch, cancellation, safe inference errors, and lease-loss cleanup.

Generation remains disabled. No model weights or GPU runtime have been installed.

## Model artifact and license preflight

Before any inference adapter can be registered:

- Review `MODEL-CANDIDATE-REVIEW.md` for the initial image/video candidates, primary-source license notes, and upstream hardware claims.
- `runtime_manifest.py` accepts only exact model revisions (40-character commit SHA or SHA-256 revision), explicit modality/runtime, bounded capabilities, and an explicit list of artifact paths, sizes and SHA-256 hashes.
- Remote model code execution is forbidden. Model files must already exist under a dedicated model root; every file is checked for path traversal, symlinks, exact size and checksum.
- Limits: 50 GiB per artifact, 100 GiB total per model, at most 1,000 files, and at most 50 model entries in one manifest.
- This is preflight verification only. It does not download, load, execute, or enable a model. No runtime manifest is configured by default.

Do not accept gated model licenses, download weights, or enable inference until the full license and every model component have been reviewed, immutable revisions/checksums are recorded, and measured host resource limits are approved.

- `runtime_registry.py` binds verified manifest entries only to code-owned runtime factories. The manifest can name an allowlisted runtime label, but cannot import a module or select an arbitrary Python entry point.
- If no trusted factory is installed for a runtime, that model is omitted from the adapter registry; the worker therefore cannot claim jobs for it.
- Factory output must expose `generate` and report the exact model ID/revision from the verified manifest.

- Every runtime manifest entry must also include a license identifier and `license_reviewed_by_owner` boolean. The code-owned adapter registry skips any model whose owner-review attestation is not explicitly true.
- This is a project configuration gate, not legal advice or automatic license acceptance. For gated agreements, an adult account owner must read the current full terms and decide whether to accept them. ASTRA never automates license acceptance.
