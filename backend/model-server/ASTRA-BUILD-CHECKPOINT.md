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

1. Confirm latest CI result for the current head and fix any failures.
2. Add a provider-neutral model capability registry and deterministic routing policy. It must reject unknown/unavailable models, check modality, aspect ratio, resolution, and resource declarations, and never silently fall back.
3. Define asynchronous generation-job lifecycle contracts (queued, running, succeeded, failed, cancelled) and bounded queue semantics. Keep implementation storage-neutral until persistence and worker hosting are chosen.
4. Add media output validation: content type, byte-size bounds, image dimensions, video metadata/duration, checksums, and safe URL handling.
5. Add character/reference asset manifest design and consistency metadata without storing personal media in public locations.
6. Add integration tests for authentication, malformed payloads, queue limits, timeout/cancellation, provider failure, and output validation.
7. Reassess image/video model candidates and licenses from primary sources before choosing any runtime.
8. Only after model license, hardware, and budget decisions: add a small runtime adapter and benchmark it against the existing blind prompt pack.
9. Keep image/video generation paused until private inference, resource ceilings, access controls, storage, and end-to-end tests are proven.

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
