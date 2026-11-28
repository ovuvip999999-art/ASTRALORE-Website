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

## Fail-closed moderation gate

- `safety_gate.py` defines an injected moderation-provider contract for both the user prompt and generated media output.
- Only an explicit high-confidence `allow` decision with a benign/none category proceeds. Block, review, malformed decisions, low confidence, invalid input, or provider outages fail closed.
- The worker runner refuses to claim any job unless both an exact-revision generation adapter and a moderation gate are supplied.
- Prompt moderation occurs before model inference; output moderation occurs after byte/container validation and before private upload.
- No moderation model/provider is installed yet. This is an interface and enforcement gate, not evidence that ASTRA currently has effective moderation coverage. A vetted provider, adversarial testing, and human escalation policy are required before enabling generation.

## Cloudflare Worker queue bridge (disabled by default)

- `backend/queue-proxy.mjs` validates a strict `queueAction` contract and forwards create/status/cancel/asset-url requests to fixed model-server routes. It never accepts a caller-supplied URL or owner UUID.
- `backend/worker.js` first verifies the caller's Supabase session, then forwards that same user access token with the server-only `ASTRA_MODEL_SERVER_TOKEN`. The server token is never returned to the browser.
- Queue creation additionally requires explicit `costAcknowledged: true` and all Worker readiness/approval flags: `ASTRA_QUEUE_API_ENABLED`, `ASTRA_MODEL_RUNTIME_READY`, `ASTRA_MODERATION_READY`, `ASTRA_WORKER_PROCESS_READY`, `ASTRA_CREATIVE_GENERATION_APPROVED`, and `ASTRA_COST_POLICY_APPROVED` must be set to `true`.
- The model server has its own independent `ASTRA_QUEUE_API_ENABLED` flag, also false/unset by default.
- These flags are deployment approvals, not automatic proof of host health. They must not be enabled until actual model, moderation and worker readiness have been verified.
- The existing direct `creativeAction` generation path still returns the fail-closed pause response before any provider call. This bridge only submits durable jobs; it does not generate media.
- No queue flags, URLs, secrets or readiness approvals have been configured, and no Worker has been deployed with this bridge. The frontend does not yet submit `queueAction` requests.


**Cost-policy clarification:** `ASTRA_COST_POLICY_APPROVED` is an explicit owner approval of a documented, measured cost policy. It does not mean self-hosted inference is inherently free; GPU hosting, storage, electricity and bandwidth may still cost money. Never enable it without an adult account owner's review of the actual budget.

## First model-specific local adapter: SD 3.5 Medium

- Added `sd35_adapter.py` using the built-in Diffusers `StableDiffusion3Pipeline` for the initial image candidate.
- The loader accepts only the exact model ID, image modality, Diffusers runtime, owner-attested license review, and a fully enumerated local model directory whose files are rechecked for SHA-256, size, and mutation immediately before loading.
- Loading uses `local_files_only=True`, `use_safetensors=True`, and required model CPU offload. It refuses to initialize without CUDA or the manifest-declared minimum free VRAM.
- Generation is bounded to 256–1024 pixels per side, 1 MP total, 10–50 steps, one image, bounded guidance, and deterministic seeds. Cancellation is checked at denoising steps.
- The adapter is available through a code-owned factory for the verified runtime registry. It is not automatically registered or enabled.
- Tests use a mocked Diffusers pipeline and fake CUDA runtime; they do not download weights or run actual inference.

The current Diffusers documentation describes three SD3 text encoders and notes that full-pipeline execution can be challenging below 24 GB VRAM; CPU offload is recommended. Treat the manifest's `min_vram_mb` as a host-specific gate that must be set after measurement, not as a universal upstream guarantee.

No SD3.5 license has been accepted, no weights have been downloaded, and no PyTorch/Diffusers GPU environment is installed. A gated license must be reviewed by an adult account owner before acceptance.

The model server independently rechecks readiness before accepting `POST /v1/jobs`. In addition to its own `ASTRA_QUEUE_API_ENABLED=true`, it requires `ASTRA_MODEL_RUNTIME_READY`, `ASTRA_MODERATION_READY`, `ASTRA_WORKER_API_ENABLED`, `ASTRA_WORKER_PROCESS_READY`, `ASTRA_CREATIVE_GENERATION_APPROVED`, and `ASTRA_COST_POLICY_APPROVED` all to be true. This server-side gate is separate from the Cloudflare Worker proxy gate. These are explicit approvals/configuration assertions, not a substitute for measured health checks; keep them false until all actual components are deployed and verified.

## First model-specific local video adapter: Wan2.1 T2V 1.3B

- Added `wan21_adapter.py` for the Diffusers-format `Wan-AI/Wan2.1-T2V-1.3B-Diffusers` candidate.
- Requires the exact model ID, video modality, `wan-video` runtime, Apache-2.0 license identifier plus owner review attestation, CUDA with bfloat16 support, manifest-declared free VRAM, and a fully enumerated local model directory whose file hashes are rechecked before load.
- Loads the VAE in float32 and pipeline in bfloat16, local-files-only and safetensors-only; configures the 480p scheduler flow shift and requires CPU offload.
- Initial output is fixed at 832×480, 81 frames at 16 fps (about 5.06 seconds), one MP4. The worker checks actual probed duration against the requested duration within 250 ms before upload.
- Generation is bounded to 20–50 inference steps, one output, bounded guidance and deterministic seed; denoising callbacks observe cancellation.
- Added a code-owned factory for the verified runtime registry and mocked tests. No model weights or GPU runtime were downloaded/installed and no actual video inference was run.

The upstream Diffusers Wan guide reports about 13 GB VRAM for its T2V example; use a host-specific measured `min_vram_mb` rather than assuming that figure guarantees a working deployment. The original model card's 8.19 GB claim is for its upstream setup, not ASTRA's Diffusers pipeline.

## Worker bootstrap composition root

- `worker_bootstrap.py` composes the verified model manifest, code-owned adapter factories, moderation provider, private worker API client, and private asset store into a `GenerationWorker`.
- Startup fails before any queue claim if the moderation provider, queue client, asset store, owner-reviewed model, verified artifacts, or trusted adapter factory is missing.
- The bootstrap accepts factories and providers as code dependencies; it does not dynamically import modules named by a manifest or environment variable.
- Tests use temporary files and fake adapters/providers. This does not start a daemon or deploy a worker process.


## Container sandbox policy foundation

`sandbox_policy.py` builds a Docker invocation for a future model worker. It requires an administrator-pinned image digest and explicit GPU device, mounts verified model files read-only, disables networking, makes the container root filesystem read-only, drops Linux capabilities, uses a non-root UID, enables no-new-privileges, and applies Docker memory/swap, CPU, PID, shared-memory and bounded tmpfs output limits. The tmpfs output volume is capped at 512 MiB and writable only by the runtime UID.

`build_execution_plan` also exposes a wall-clock deadline for the parent supervisor to enforce. **This is a policy/command-builder foundation only:** it does not launch Docker, enforce the parent timeout, isolate the existing in-process worker, or prove that a deployment host is hardened. It is not wired into `GenerationWorker`; the current worker runner still invokes its injected adapter in-process. Do not enable a worker or generation until a separate supervised container executor is integrated and tested on the target Linux/GPU host.

## Worker process loop

- `worker_process.py` wraps an already bootstrapped `GenerationWorker` in a graceful polling loop.
- Empty queues use a bounded idle wait; private API transport failures use capped exponential backoff; a supplied stop event allows clean shutdown.
- Unexpected programming/runtime errors are not silently swallowed and can be handled by the process supervisor.
- The loop does not create a worker, configure secrets, or deploy anything. It can only be used after `worker_bootstrap.py` has verified local models and a reviewed moderation provider.
