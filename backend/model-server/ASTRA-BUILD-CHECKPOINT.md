# ASTRA V2 Build Checkpoint

Last updated: 2026-11-28
Repository: `ovuvip999999-art/ASTRALORE-Website`
Working PR: [#20 — ASTRA V2](https://github.com/ovuvip999999-art/ASTRALORE-Website/pull/20)
Branch: `feature/astra-creative-skills`
Base: `feature/astra-cloud-memory`

## Current verified repository state

- PR #20 is open, draft, and unmerged. Keep it that way unless the owner explicitly decides otherwise.
- PR #19 and production must remain untouched.
- Image/video generation is still blocked by the Worker-level fail-closed guard.
- The private FastAPI model-server scaffold exists, but it has no model weights or inference runtime.
- Self-hosted provider adapter and request/response contract exist.
- Blind quality evaluator, initial 12-prompt benchmark pack, and unit tests exist.
- Deterministic Creative Brief Compiler exists at `backend/model-server/creative_brief.py`.
- Authenticated endpoint exists at `POST /v1/brief/compile`.
- Compiler preserves the original prompt, validates structured fields and bounds, and creates a deterministic SHA-256 brief fingerprint.
- The compiler is not an LLM and does not interpret arbitrary natural language into scene semantics. It only normalizes and assembles fields the caller explicitly supplies.
- Model-server CI compiles and runs API, compiler, and quality-evaluator tests.

## Latest compiler commits

- `40ab7ead79d59a0f35b3beae0429442ff5472010` — compiler module
- `a9fdd350b5aec91a16176085926c9e81e7e3726c` — compiler tests
- `7e70a666ac706cebef1a07f9306e5ca13c79fba0` — authenticated API route
- `e1e10d1d63c121091c60fb686171007ef01dc4cc` — API tests
- `fdc853c6a8c2fc27dc85285a8dac23cda71b6f60` — CI coverage
- `63cff95efc6b7e77503e1432040c94b806528545` — README
- `a41f29d52bf9b16778ea1fa8cd3787360fd79e0b` — malformed enum type validation
- `24d6d911d049381244594b8ea5fb743d421e7a47` — malformed enum tests

## Safety and authorization boundaries

Do not:
- Deploy a Worker or production Pages site.
- Merge PR #20 or close PR #19.
- Apply Supabase migrations 0008/0009.
- Configure paid GPU hosting, billing, payment, or paid inference.
- Download large model weights or start expensive GPU jobs.
- Add secrets to source code or frontend.
- Remove the generation fail-closed guard.

Self-hosting removes a third-party inference API dependency; it does not remove GPU, electricity, storage, network, or maintenance costs. No zero-cost hosting assumption is permitted.

## Next development sequence

1. Reconfirm the latest PR head and CI result before editing.
2. Add private Worker-to-model-server integration for the authenticated job API, preserving the Worker-level generation pause and queue API default-off state.
3. Implement private worker claim/heartbeat/completion flow only after media-byte/container validation and private asset storage are designed and tested.
4. Add character/reference asset manifests and consistency metadata, with private owner-scoped storage and explicit retention controls.
5. Review image/video model candidates and licenses from primary sources; select pinned model revisions only after capability, hardware, and legal review.
6. Implement one small inference adapter in an isolated test environment, with measured GPU memory, timeouts, queue caps, and hard resource ceilings.
7. Run the blind benchmark pack against real outputs and compare quality, latency, memory, and artifact rates before making quality claims.
8. Add live Worker-to-private-model-server end-to-end tests and failure-injection tests.
9. Keep image/video generation paused until private inference, resource ceilings, access controls, durable jobs, media validation, and end-to-end tests are proven.

## Handover instruction

When resuming, fetch PR #20 and this checkpoint first, inspect the latest CI status and current branch head, then continue from the first unfinished item above. Do not assume this document's listed head is still current; verify GitHub before editing.

## Additional completed milestone — explicit model registry

- Added `model_registry.py` with strict catalog validation and deterministic capability checks.
- Added authenticated `POST /v1/models/route`; caller must name an exact catalog model.
- Enforces modality, aspect ratio, dimensions, pixel ceiling, enabled state, and explicit model ID.
- Unknown/disabled/incompatible models fail closed. No silent fallback exists.
- Catalog is server-configured via `ASTRA_MODEL_CATALOG_JSON`; no model entries are enabled or weights installed by default.
- Runtime VRAM still must be measured by the eventual inference worker immediately before execution; catalog metadata alone is not a GPU availability check.
- Added unit tests for catalog validation, malformed types, dimensions, modality, ratio, disabled models, and API behavior.

- CI run #499 (`46137260906`) passed both `syntax` and `model-server` jobs on commit `912a1e5e288cdf8e9ce28cce0abbe8b254baf740`.
- After that green run, API request models were further hardened to reject unknown top-level fields (commit `7dc0e9fed21952c655c85d3f1e84eba1717b9251`); a fresh CI run for the new head must be checked before treating that final hardening as verified.

- CI run #503 (`46137314116`) passed both `syntax` and `model-server` jobs on commit `fd15e06a12e89ce9bd63ab686c08b6434914d588`, including the strict API request-schema hardening.

## Additional completed milestone — generation job lifecycle contract

- Added `job_lifecycle.py`, a storage-neutral state machine for queued/running/succeeded/failed/cancelled jobs.
- Enforces legal transitions, terminal-state immutability, idempotent duplicate transitions, timezone-aware monotonic timestamps, safe machine-readable failure codes, and modality-matched output metadata.
- Output metadata validation includes MIME allowlists, UUID asset IDs, SHA-256, positive dimensions/size, a 512 MiB ceiling, and bounded video duration.
- Added unit tests and CI coverage.
- This is not a persistent queue or worker. Durable production execution still needs transactional job storage, atomic claims, worker leases, retries, cancellation signaling, ownership checks, and concurrency/resource limits.

- CI run #518 (`46137466996`) passed both `syntax` and `model-server` jobs on commit `81f6923592ff033d90f3fc03e03950265c582ca7`; the job lifecycle tests passed.

## Additional completed milestone — real HTTP integration tests

- Added `requirements-dev.txt` with the HTTP test client, keeping test-only dependencies separate from the runtime requirements.
- Added FastAPI TestClient coverage for health output, bearer authentication, brief compilation, invalid schema rejection, explicit model routing, missing catalog behavior, and the deliberately fail-closed image/video generation endpoints.
- CI run #530 (`46137570671`) passed both `syntax` and `model-server` jobs on commit `069356fa025f0ddffdcc80b286ba9c5e1ad42cbb`.
- These tests exercise HTTP routing in CI, but no live GPU inference or deployed Worker-to-model-server end-to-end test has occurred.

## Security and health-reporting hardening

- Health now reports `imageModelConfigured` / `videoModelConfigured`, not "ready"; a configured model ID is not evidence of a working runtime.
- Private model-server bearer secrets shorter than 32 characters fail closed.
- Added tests for weak-secret rejection and updated all test credentials to meet the minimum.
- CI run #545 (`46137702289`) passed both jobs on commit `740a2e5a129c86c8eb6c65e394eb7f63fb14f7d7`.

- Output metadata safety ceiling tightened: maximum 512 MiB, 16,384 pixels per side, 100 megapixels total, and video duration up to 120 seconds. Added regression tests.

- CI run #556 (`46137819590`) passed both `syntax` and `model-server` jobs on commit `e6da0d281efe3ee6409ce685efbf245bb327342d`, including output-dimension safety tests.

## Local Windows testing

- Added `run-tests.ps1` for the user's Windows environment. It creates a local Python virtual environment, installs API/test dependencies, compiles the server modules, and runs all unit and HTTP integration tests.
- It does not download model weights, access a GPU, call paid services, or activate generation.

- CI runs #565 (`46137927013`) and #566 (`46137935611`) passed both `syntax` and `model-server` jobs on the Windows test-runner checkpoint head `f77eb3b71d5619ab4c52943862704280d6d2be28`.
- The PowerShell runner itself is documented but has not yet been executed on the user's Windows machine.

## Previous checkpoint head (verify current branch head on resume)

- Branch head recorded after the Windows test runner and handover updates: `19156beac903f78c1dae45bb7c948ea91e5dc7a8`.
- PR #20 remains open/draft/unmerged. Confirm the current head on GitHub before resuming.

## Durable queue foundation — 28 November 2026

- Added migration `backend/migrations/0010_astra_generation_jobs.sql`. It creates a private owner-scoped job table; this migration is a source file only and has NOT been applied to Supabase.
- Added bounded admission: maximum 2 active jobs per user and 100 active jobs globally, with per-user idempotency keys and request-mismatch rejection.
- Added atomic worker claims using `FOR UPDATE SKIP LOCKED`, bounded batch/lease settings, unique lease tokens, heartbeats, cooperative cancellation, bounded retries/backoff, expired-lease recovery, and terminal-state enforcement.
- Worker RPCs are executable only by `service_role`; end users receive RLS-scoped SELECT and an authenticated owner-checked cancellation RPC.
- Completion validates MIME type, asset UUID, SHA-256, dimensions, byte-size and video duration metadata. This does not inspect actual media bytes; future workers must validate actual files/containers before completion.
- Added `queue_store.py`, a server-side Supabase REST adapter. It verifies user access tokens through Supabase Auth, uses the service-role key only for private worker operations, and uses the user's own access token for RLS-protected reads and cancellation.
- Added mocked HTTP tests, SQL contract tests, and a PostgreSQL 16 integration suite that executes the migration and exercises idempotency, admission limits, leases, retries, completion, RLS, cancellation, and concurrent claims.
- Added PostgreSQL 16 as an ephemeral CI service. CI run #650 passed both jobs and all 88 Python tests, including actual execution of migration 0010 against the ephemeral database. No production database was touched.
- Added `psycopg[binary]` as a development/test dependency only.
- Queue API routes are not yet wired; there is no worker process, model runtime, or media storage. The Worker generation fail-closed guard remains unchanged.
- Migration 0010 has not been applied. Do not apply migrations 0008 or 0009. No deployment, secrets, billing, GPU host, or model weights were configured.

## Authenticated queue API milestone

- Added `queue_api.py` and mounted its router in `app.py`.
- Added `POST /v1/jobs`: requires the private server token plus a valid Supabase user access token; derives `user_id` from the Supabase Auth response, compiles the structured brief, checks the exact enabled model against the server catalog, and enqueues with an idempotency key.
- Added owner-scoped `GET /v1/jobs/{job_id}` and `POST /v1/jobs/{job_id}/cancel`. Reads/cancellation use the caller's Supabase token so RLS and `auth.uid()` enforce ownership.
- Queue API is explicitly disabled unless `ASTRA_QUEUE_API_ENABLED=true`; no browser or Worker integration is active.
- Added API tests for default-off behavior, private-secret enforcement, user session verification, derived owner identity, model/brief validation, status visibility, and cancellation.
- There are no worker claim/completion HTTP routes and no inference worker. The service-role queue operations remain in the private storage adapter only.
- Early PostgreSQL CI runs exposed and helped fix a malformed/duplicated SQL fragment and a lease-recovery test timing assumption. The migration was restored and corrected; CI run #650 is the passing verification checkpoint.

## Latest verified queue checkpoint

- Code head tested by CI run #650: `41522f38c57265afdceff769c22474d9b7b8fff1`.
- CI run #650 passed both `syntax` and `model-server`; the model-server suite ran 88 tests successfully against the ephemeral PostgreSQL 16 service.
- The migration was executed only in the disposable CI database. Supabase production/preview was not touched.
- PR #20 remains open/draft/unmerged. Migration 0010 remains unapplied. Queue API remains disabled by default.

## CI follow-up after checkpoint documentation update

- Latest branch head tested: `2a68f36f5223d888341adf77a6325c75a7216f3b`.
- CI run #653 passed both `syntax` and `model-server` jobs, including the PostgreSQL 16 migration/integration suite and all 88 Python tests.
- PR #20 remains open/draft/unmerged; production and PR #19 remain untouched.

## Actual media-byte validation foundation

- Added `media_validation.py` to inspect actual local image/video files before a future worker marks jobs successful.
- Image inspection uses Pillow to identify, verify, and fully decode PNG/JPEG/WebP bytes.
- Video inspection uses local `ffprobe` with `shell=False`, a restricted `file,pipe` protocol whitelist, timeout, and bounded JSON output; only MP4/WebM are accepted.
- Computes SHA-256 from the actual file and checks file identity, size, and modification time before/after inspection to detect mutation.
- Worker limits: 512 MiB, 16K per side, 40 megapixels, 120-second video duration. The 40 MP cap is stricter than the database's 100 MP metadata ceiling to reduce decode-memory risk.
- Added tests using real Pillow-generated image fixtures and mocked ffprobe success/failure responses. Added Pillow to runtime requirements and included tests in CI/Windows runner.
- This is not yet wired to a worker or private storage. A future worker must run inspection in a restricted process/container, upload validated bytes privately, then complete the job. Generation remains disabled.

## Private generated-media storage milestone

- Added migration `0011_astra_private_generated_assets.sql` to create a private Supabase Storage bucket with public access disabled, a 512 MiB object limit, and PNG/JPEG/WebP/MP4/WebM allowlist. Migration has NOT been applied.
- Added a restrictive Storage RLS policy for `anon` and `authenticated` so even a broader permissive policy cannot grant access to the ASTRA generated-media bucket. The future worker uses only server-side `service_role`.
- Added `asset_store.py`, which streams validated files (no full-file memory buffering) to deterministic owner/job/asset object paths. It exposes no public or signed URL.
- Upload adapter rechecks open-file identity, size and SHA-256 during transfer, disables overwrite, rejects path traversal/symlinks, and never deletes an existing object after an upload conflict.
- Updated migration 0010 completion RPC to require a storage path exactly matching job owner UUID, job UUID, asset UUID and MIME-derived extension. It cannot accept metadata pointing to another user's or another job's object.
- Added unit tests for successful private upload, streaming headers/path, digest mismatch cleanup, conflict safety, invalid IDs, and path traversal.
- Expanded PostgreSQL integration tests to execute both migrations and simulate a broad permissive Storage policy; the restrictive rule must still block the private bucket.
- Added tests to CI and the Windows PowerShell runner. CI verification for this new milestone is pending.
- No Supabase migrations have been applied; no Worker integration, worker process, signed download endpoint, model runtime, or deployment exists. The generation fail-closed guard remains active.

## Next work after private storage

1. Verify CI on the latest head, including the ephemeral PostgreSQL migration and RLS tests.
2. Build a private worker control plane with claim/heartbeat/complete/fail operations protected by a separate worker credential and lease tokens; do not expose worker operations to browsers.
3. Add an isolated worker loop that enforces hard concurrency, time, memory, disk and cancellation limits; keep inference disabled until an approved runtime exists.
4. Add owner-authorized signed asset retrieval through the authenticated API; do not make the bucket public.
5. Add private Worker-to-model-server job submission/status integration only behind the existing fail-closed generation guard and an additional explicit disabled-by-default flag.
6. Review and select model revisions/licenses, then build a small isolated inference adapter and benchmark actual outputs.


## Private worker control plane milestone

- Added `worker_api.py`, mounted in FastAPI separately from the user/Worker job API.
- Internal routes: claim bounded batch, heartbeat lease/cancellation, complete with output metadata, and fail with safe error code/retryable flag.
- Uses separate `ASTRA_WORKER_TOKEN` (minimum 32 characters, constant-time compare) and explicit `ASTRA_WORKER_API_ENABLED=true`. Default disabled.
- Worker control endpoints are not exposed through the Cloudflare Worker or browser; they are intended only for a future private server-to-server network.
- Added HTTP tests for disabled default, missing/weak/wrong credentials, bounded claims, lease expiry/cancellation, completion, failure codes, and malformed IDs.
- Added test module to CI and Windows runner. CI verification is pending.
- No polling process, inference, public worker endpoints, secrets, or deployment have been added.


## Latest resume checkpoint

- Worker control plane and private asset storage code are committed to `feature/astra-creative-skills`; verify latest head and CI before further edits.
- Migrations 0010/0011 remain unapplied. Queue API and worker API remain disabled by default. Generation remains blocked at the Cloudflare Worker.

## Owner-authorized private asset retrieval milestone

- Added `GET /v1/jobs/{job_id}/asset-url` to the authenticated queue API.
- It first verifies the internal server secret and the caller's Supabase access token, then reads the job using the caller's RLS context.
- Only succeeded jobs with a storage path exactly matching the authenticated user, job, asset UUID and MIME extension can receive a URL.
- The asset adapter requests a 60-second signed URL using the server-only service-role credential and validates that the returned URL is relative and points to the exact private bucket/object.
- Added tests for success, missing jobs, incomplete jobs, cross-owner path rejection, signing failures, invalid paths, external signed URL rejection and lifetime bounds.
- The bucket remains private; signed URLs are bearer links and must not be logged. The queue API remains disabled by default.
- CI verification for the newest signed-URL and worker API tests is pending.


## Latest code update after private asset retrieval

- Hardened signed URL validation to require a non-empty token query parameter and a relative URL for the exact private object.
- Hardened streaming upload cleanup if the file disappears or cannot be stat'ed after transfer.
- Added tests for owner-authorized asset URL creation and malformed/external signing responses.
- Latest code head at this checkpoint: `03da72783dc5c629af2b4192fa210ad7d7e9270d`.
- CI runs #738/#739 are in progress; confirm both syntax and model-server jobs before treating this head as verified.
- PR #20 remains open/draft/unmerged. Migrations 0010/0011 are unapplied. Queue API and worker API are disabled by default. Generation remains blocked.

## Fail-closed worker orchestration milestone

- Added `worker_client.py` with HTTPS-only (loopback exception for local tests), separate worker-token auth, bounded claim/lease calls, strict response validation, and distinct handling for confirmed HTTP 409 lease loss.
- Added `worker_runner.py` as an injectable orchestration library. It only claims jobs when an exact-revision adapter map is explicitly supplied; an empty map returns without touching the queue.
- Runner flow: exact model ID + immutable revision lookup, heartbeat thread, cooperative cancellation, generated-file validation, requested-dimension check, private streaming upload, and lease-scoped completion/failure.
- On confirmed lost lease after upload, removes the uncommitted object. On ambiguous completion transport failure, deliberately retains the object because the database may already have committed; a future orphan reconciler is needed.
- Added tests with mocked model adapters for fail-closed no-adapter behavior, exact revision selection, successful local image pipeline, dimensions, cancellation, safe errors, and lease-loss cleanup.
- No inference adapter exists or is registered. No model weights, GPU runtime, worker daemon, resource-limited container, or deployment exists. Generation remains blocked.
- Latest worker orchestration CI coverage is pending.


## Verified CI — worker orchestration

- CI run #766 (`46140532387`) passed both `syntax` and `model-server` jobs on head `9c30692b2a0a44e82b42f1e39cccd4235b2ebb25`.
- Model-server suite ran 132 tests successfully, including PostgreSQL 16 integration for queue and private Storage migrations.
- The worker runner was tested with mocked adapters only; no real inference runtime or model weights were used.

## Model candidate and artifact preflight milestone

- Added `MODEL-CANDIDATE-REVIEW.md` using primary model-card/repository sources. Initial image evaluation candidate: Stable Diffusion 3.5 Medium (Stability Community License; gated terms require adult account-owner review). Initial video evaluation candidate: Wan2.1 T2V 1.3B (Apache 2.0; upstream reports 8.19 GB VRAM and ~4 minutes for 5 seconds at 480p on RTX 4090).
- These are evaluation candidates, not final production selections. No gated license has been accepted and no weights have been downloaded.
- Added `runtime_manifest.py` to validate immutable model revisions, allowed runtime identifiers, modality/capability bounds, artifact paths, file sizes and SHA-256 checksums inside a local model root.
- Manifest rejects remote code execution, path traversal, symlinks, missing/mismatched files, duplicate entries, and oversized model bundles.
- Added unit tests and included manifest validation in CI and Windows runner. Verification pending.
- This module does not download/load weights or activate inference. No runtime manifest or model adapter is configured. Generation remains disabled.

