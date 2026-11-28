# ASTRALORE / ASTRA — Master Project Checkpoint

**Checkpoint date:** 2026-11-28  
**Purpose:** Durable handover for future ChatGPT conversations. This file is the project resume source of truth; do not rely on chat memory alone.

## 1. Repository and active development location

- Repository: `ovuvip999999-art/ASTRALORE-Website`
- Active PR: [#20 — ASTRA V2: Skills + Image & Video Studio Foundations](https://github.com/ovuvip999999-art/ASTRALORE-Website/pull/20)
- PR state: OPEN, DRAFT, NOT MERGED.
- PR head branch: `feature/astra-creative-skills`
- PR base branch: `feature/astra-cloud-memory` (do not silently change the base).
- Last verified PR head at checkpoint creation: `e2a82aa1c8e13fe88665af6b3aa45d5b50ecb361`
- PR snapshot: 366 commits, 75 changed files.
- Keep PR #19 and production untouched unless the owner explicitly authorizes otherwise.
- Never merge, deploy, apply production migrations, enable generation, incur paid compute, or alter secrets without explicit owner approval.

## 2. Project purpose

ASTRA is the AI production system inside ASTRALORE. The long-term goal is an ASTRA-owned creative platform with:
- Image generation and video generation as separate modalities.
- A provider-independent creative API and explicit model registry.
- Structured creative briefs and repeatable prompt handling.
- Durable generation jobs, private asset storage, worker orchestration and moderation.
- Locally hosted/open model runtimes where feasible, with licensing and hardware constraints respected.
- Character/style consistency, post-processing and a blind quality benchmark.
- User-facing Image Studio and Video Studio integrated into the ASTRALORE website.

Do not describe the current scaffold as a functioning image/video generator. The interfaces and contracts exist, but real inference has not been run.

## 3. Current verified implementation

### Website / Worker
- Image Studio and Video Studio UI foundations exist.
- Skills UI supports private Markdown skill management.
- `backend/creative-providers.js` defines provider boundaries and separate image/video provider selection.
- Creative generation remains fail-closed in the Cloudflare Worker.
- Separate image/video feature flags are default-off; unset/unknown providers fail closed.
- No provider should be activated just by setting a model ID.
- Cost safeguards deliberately block generation until a reliable shared budget and all approval gates exist.

### Private model-server foundation
Located in `backend/model-server/`:
- FastAPI app, Dockerfile, requirements and README.
- Authenticated brief compiler, explicit model registry/router, job lifecycle and queue API.
- Durable queue storage contract and SQL migration 0010.
- Private media storage foundation and SQL migration 0011.
- Actual image/video byte validation foundation.
- Private worker API/client, worker runner, bootstrap composition root and graceful process loop.
- Model artifact manifest validation, code-owned runtime registry and explicit owner license-review gate.
- Prompt/output moderation interface that fails closed without a real provider.
- Local-only candidate adapters: SD 3.5 Medium image and Wan2.1 T2V 1.3B video.
- Quality evaluation harness and benchmark prompt pack.
- Docker sandbox command/policy builder in `sandbox_policy.py`.

### Crucial incomplete item
The Docker sandbox work is **policy only**. It builds a restricted Docker command/plan but does NOT launch or supervise containers, enforce wall-clock timeout, kill on cancellation/lost lease, collect bounded outputs, or isolate the current worker process. Do not enable inference until a real supervised executor is integrated and tested on the target host.

## 4. Model and licensing status

- SD 3.5 Medium and Wan2.1 T2V 1.3B are evaluation candidates, not final approved production models.
- No model weights have been downloaded or installed.
- No model license has been accepted/attested by the account owner.
- Any gated license requires adult account-owner review before acceptance or download.
- No actual GPU inference has been performed.
- No GPU host or inference daemon is running.
- Self-hosting is not assumed to be free: GPU compute, storage, bandwidth and operations can cost money.

## 5. Queue, database, storage and deployment status

- Queue migration 0010 and private storage migration 0011 exist in the branch.
- Both migrations are **NOT applied** to Supabase.
- Queue API, worker API and generation are disabled by default.
- No Worker/Pages/model-server deployment has been performed from this work.
- No production secrets or runtime flags have been configured.
- No paid AI services, billing or payment integration are authorized.
- Do not apply older/superseded migrations 0008 or 0009 without a fresh migration review; the PR notes explicitly say not to apply them.

## 6. Test status

- Last explicitly documented green model-server CI checkpoint: run #1014.
- At that checkpoint: 35 Node tests and 193 Python tests passed, including PostgreSQL 16 integration and mocked worker/model adapter coverage.
- The sandbox policy tests were included in that green run.
- CI #1014 proves policy and orchestration tests with mocks; it does NOT prove Docker execution, GPU inference, model quality or production readiness.
- Newer workflow activity at the checkpoint includes successful ASTRA Cloud Memory Validation runs on the same PR head. Those are not substitutes for the model-server test suite.
- Always inspect the latest relevant workflow runs before claiming current test status.

## 7. Immediate engineering continuation

Resume from the current branch and implement a **supervised Docker inference executor** before any model execution:
1. Inspect current `sandbox_policy.py`, `worker_runner.py`, `worker_bootstrap.py`, API contracts and tests before editing.
2. Add a parent-side executor that launches only the exact immutable image digest and explicit GPU/device configuration generated by the policy.
3. Enforce wall-clock deadline from the parent process; terminate, then force-kill if needed.
4. Support cancellation and lost-lease cleanup; never leave a detached container running.
5. Enforce no network, read-only root, non-root user, dropped capabilities, no-new-privileges, read-only model mount, bounded CPU/memory/PIDs/tmpfs and explicit GPU device.
6. Use bounded structured IPC/output collection; reject symlinks, path traversal, oversized files, unexpected file types and outputs outside the designated mount.
7. Validate actual output bytes with existing media validation before moderation and private upload.
8. Ensure the worker refuses inference unless a supervised executor, exact reviewed model runtime, moderation provider, queue, private storage and all readiness/approval/cost gates are present.
9. Add unit tests using a fake Docker client/process, timeout tests, cancellation tests, lease-loss tests, output-path adversarial tests, and an opt-in host integration test that does not run by default in CI.
10. Run the complete model-server suite and relevant Node checks; record exact workflow run IDs and commit SHA in this checkpoint.

After the executor is verified, continue with host capability/preflight, model-license review, model artifact acquisition only after owner approval, VRAM benchmarking, one-image smoke test, then one short-video smoke test. Keep each stage independently gated and reversible.

## 8. Working rules for future assistants

- Treat this file plus the current GitHub branch/PR as the durable project context.
- At the start of each new conversation, read this file, inspect the PR head, inspect the latest relevant CI, and inspect the files related to the immediate task.
- Never claim to have recovered every historical chat. The 100 conversation entries visible in the user's sidebar are not automatically readable as a single archive. Use this repository checkpoint as the durable reconstruction and ask for a specific old conversation only if a decision cannot be recovered from code/docs.
- Do not make the user repeat facts already present here.
- Work in cohesive batches, but create a Git checkpoint after each meaningful milestone. Do not do a giant unreviewed rewrite.
- Before each write, inspect the current file and branch. Keep changes on `feature/astra-creative-skills` and within PR #20 unless explicitly authorized.
- After each batch: run tests, inspect the diff, record what changed, what passed/failed, exact commit SHA, and exact next task.
- Do not claim something is saved unless a GitHub commit or other durable file confirms it.
- User owns the repository and makes final decisions. Be transparent about uncertainty and ask before irreversible or cost-incurring actions.

## 9. Resume prompt

"Continue ASTRALORE/ASTRA from `ASTRALORE_MASTER_CHECKPOINT.md` in repository `ovuvip999999-art/ASTRALORE-Website`. First verify PR #20 head and latest model-server CI. Preserve PR #19 and production. The next task is the supervised Docker inference executor described in section 7. Inspect existing code before editing, work on `feature/astra-creative-skills`, test thoroughly, and update this checkpoint with the new commit and test results. Do not deploy, apply migrations, enable generation, download weights, accept licenses, or incur costs without explicit approval."

## 10. Engineering checkpoint — supervised executor first implementation (2026-11-28)

### Commits
- `3906cec2421e90eec4c775acb2cc9815057ec8c9`: added `backend/model-server/sandbox_executor.py`.
- `f4cb970e326712415d3c26c07da149d7db6b53f7`: added `backend/model-server/test_sandbox_executor.py`.
- `2c06aaa8e795915c70d7b3d484223a8e288c1955`: updated `.github/workflows/astra-cloud-validation.yml` so the new executor and tests are included in Python compilation and unittest discovery already run by CI.
- Active branch remains `feature/astra-creative-skills`; no merge or deployment performed.

### Implemented in this batch
- Parent-side Docker CLI supervisor starts a uniquely named container without auto-removal, writes a bounded JSON request to stdin, polls for cancellation and wall-clock timeout, and removes the container afterward.
- Cleanup issues Docker kill on interrupted runs and force-removes the named container.
- Output collection uses Docker copy from the container's bounded `/outputs` tmpfs and checks for exactly one non-empty regular media file, allowed media suffix, no symlinks, bounded total bytes and bounded file count.
- Process invocation uses argument arrays, no shell, and discards container stdout/stderr to avoid unbounded log capture.
- Added deterministic fake-process tests for successful collection, cancellation, nonzero exit, pre-populated output directory, unsupported output type and invalid JSON payload.
- CI workflow compile list now includes `sandbox_executor.py` and `test_sandbox_executor.py`.

### Important limitations — not yet production-ready
- This is the first executor layer only. It is NOT yet wired into `GenerationWorker` or `worker_bootstrap.py`.
- The trusted `astra_sandbox_entrypoint` module is not yet present in the repository/runtime image. A dedicated model-runtime image containing the reviewed adapters and this entrypoint must be designed and pinned by digest before real container inference.
- The current API Dockerfile is not the GPU model-runtime image. Do not use it as the model runtime.
- The executor uses the existing policy's container command, but host bind-mount collection, Docker daemon trust, host integration behavior, timeout/lease race handling and Windows/Linux host behavior still need dedicated review and tests.
- No Docker daemon or GPU execution was run in this environment. No model weights downloaded. No inference performed. Generation remains disabled.
- GitHub Actions run `46145488449` for commit `2c06aaa8e795915c70d7b3d484223a8e288c1955` completed successfully: both `syntax` and `model-server` jobs passed, including compile and full `python -m unittest -v` discovery. Duplicate PR run `46145484297` also passed both jobs. Earlier run `46145458942` for the test-file commit also passed both jobs. The final checkpoint-only commit below triggered run `46145535179`; its syntax job passed and its model-server job was still running when last checked.

### Exact next engineering actions
1. Confirm the model-server job in run `46145535179` completes successfully; the equivalent full test suite already passed in run `46145488449` for the code/workflow commit.
2. Harden executor tests: verify Docker copy failures, symlink/path traversal behavior, output byte cap, timeout cleanup, container name handling and cleanup failures.
3. Resolve a key architecture issue: existing SD3.5/Wan adapters load and run inside the worker process. Define a strict request/response protocol and a dedicated trusted model-runtime image that initializes only code-owned model adapters from the verified model manifest, with no model downloads or remote code.
4. Wire a sandbox-backed adapter into worker bootstrap so no model adapter can execute in-process in production. Keep fake adapters available only to tests.
5. Ensure heartbeat lease loss/cancellation always terminates the named container before worker cleanup returns; cover race cases with tests.
6. Add opt-in Docker host integration tests; they must not run on ordinary CI unless a dedicated runner is configured.
7. Update this file with exact CI run IDs, final test counts and commit SHA after each batch.

## 11. Trusted runtime entrypoint — first implementation (2026-11-28)

### Commits
- `df92cacd8db7c1a105e630a30a3b2e723d04b1f1`: added `backend/model-server/astra_sandbox_entrypoint.py`.
- `bd1e45145c19be7256b2e16f86088171d8eaa4c8`: corrected Wan adapter factory name to the actual code-owned `make_wan_factory`.
- `7031f38be0f6f243f3331062c2c7c283c2693efc`: added `test_astra_sandbox_entrypoint.py`.
- `c1c7c954630ac7b323127db5db8a2a09df503a56`: added entrypoint and tests to model-server CI compile list.
- Latest branch head at checkpoint: `c1c7c954630ac7b323127db5db8a2a09df503a56`.

### Implemented
- One-job stdin JSON protocol with exact top-level field allowlist and 1 MB input bound.
- Selects exactly one model by model ID and immutable revision.
- Parses the strict model manifest and re-verifies selected model artifacts inside the container under `/models`.
- Requires owner-reviewed license attestation and uses only code-owned SD3.5 / Wan adapter factories.
- Ensures output directory begins empty and output file resolves inside `/outputs`.
- Emits only a small success filename record; errors are sanitized.
- Added protocol shape, unknown-field and model-root containment tests.
- CI run IDs for the entrypoint commits: `46147802086`, `46147815534`, `46147832270`, `46147841426`. These were queued/in-progress at checkpoint update; inspect final conclusions before claiming green.

### Important limitations
- Entrypoint is not yet connected to `DockerSandboxExecutor` payload contract. The executor currently accepts arbitrary payload dicts and does not itself ensure the required `model_id`, `model_revision`, `job`, and `manifest` fields are provided.
- The executor currently discards container stdout, so the entrypoint's structured success record is not yet consumed. Parent must capture a strictly bounded stdout protocol (or use a dedicated result file) without unbounded buffering.
- `GenerationWorker` still invokes adapters in-process. No sandbox-backed adapter is registered in `worker_bootstrap.py`.
- Runtime image build definition, pinned runtime dependencies, manifest-to-container request construction, lease-loss container cancellation, host integration tests and GPU execution are still outstanding.
- Do not deploy or enable inference. This is an entrypoint scaffold, not an operational generation runtime.

### Next actions
1. Check CI run `46147841426` and duplicates for syntax/model-server success; fix test failures.
2. Implement a sandbox adapter conforming to `GenerationAdapter` that passes only the exact job/model/revision and owner-reviewed manifest into the container.
3. Update supervisor to capture bounded stdout protocol, verify returned filename exactly matches the one output copied, and reliably kill/remove container on cancellation, timeout and lease loss.
4. Add a separate GPU runtime Dockerfile and pinned requirements; keep API Dockerfile separate. Do not include/download model weights in the image.
5. Wire sandbox adapters into `worker_bootstrap.py` as the only production path; in-process adapters must remain test-only.
6. Add tests for protocol mismatch, stdout overflow, timeouts, cancellation, lease loss, Docker cleanup errors and worker integration.
