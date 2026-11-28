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

## 12. Sandbox adapter bridge — first implementation (2026-11-28)

### Commits
- `2ddb7176aea53ced2e04fabebc98a0d48e8bc9a3`: added `backend/model-server/sandbox_adapter.py`.
- `ae280291b908c661a7a4d02d275f60db299118d6`: added `backend/model-server/test_sandbox_adapter.py`.
- `d9cb8ead43a9da7791dd14e7e93709f10037528a`: included adapter and tests in CI compile/discovery.
- Branch head at this checkpoint: `d9cb8ead43a9da7791dd14e7e93709f10037528a`.

### Implemented
- Added a `SandboxGenerationAdapter` implementing the worker's generation adapter contract.
- Enforces exact model ID, immutable revision, and modality match before container launch.
- Builds the entrypoint request from a verified model record and strips host-only resolved filesystem paths from the manifest payload.
- Delegates execution to the Docker supervisor and maps cancellation, timeout and output validation failures to stable worker error codes.
- Added tests for exact manifest payload, revision mismatch refusal and cancellation mapping.
- CI now compiles and discovers the new adapter tests.

### Limitations
- The adapter is not yet wired into `worker_bootstrap.py`; bootstrap still uses in-process factories.
- Docker supervisor currently discards stdout, while entrypoint emits a small status line. Output file copy is currently the effective success signal; protocol/result matching should be hardened.
- The executor's output copy helper currently ignores Docker CLI return codes; a failed `docker cp` can be misreported later as invalid output. Fix this before host use.
- No Docker host integration or GPU inference has been run. No model weights downloaded, no license accepted, no migrations applied and no deployment performed.
- The model runtime Docker image is not yet built or digest-pinned in an actual registry.

### Next
1. Harden executor command result handling and stdout/result protocol, including copy errors, timeout and cleanup failures.
2. Wire sandbox adapter as the only production bootstrap path; ensure no in-process model factories can be selected by production worker.
3. Add GPU runtime Dockerfile and pinned dependencies, then run static image build checks only. Do not pull weights or run GPU inference.
4. Add worker integration tests proving lease-loss/cancellation stops the sandbox process and no output is uploaded after lease loss.



## 13. Supervised sandbox worker integration and executor hardening — 2026-11-28

### Commits
- `8fcd1d5ff4df7c09ba01e2859c07db77da837f70`: Docker control commands now report exit status; failed `docker cp` is rejected even if a partial file appears in the destination; successful execution requires confirmed container removal.
- `d23bd9b321447026570fcf3461e4a9328c36f738`: regression test for failed Docker copy with a partial output file.
- `881894482b57e8da2ce1fb616ce1b88c5f6d0e86`: corrected the Wan runtime entrypoint to call the actual code-owned `make_wan_factory`.
- `81b918058ddaf9a43aaed2b346d0808d32a1ee25`: regression test for Wan factory binding.
- `15e5e9db40363f9f41929a7b2c27e4b9db203a7a`: added `build_sandbox_adapter_registry`, binding verified exact model revisions only to the supervised Docker adapter and checking verified files remain under the configured model root.
- `73eb59c2de1ac65e7eead3f0f297453de8d4c859` and `aeb803eff9c975cc7d4ababf1eeca80c61ae904b`: worker bootstrap now requires a `DockerSandboxExecutor`, verifies the sandbox model mount exactly matches the host-verified model root, and registers sandbox adapters instead of loading model adapters in the worker process.
- `bcf73a98aa5710d384ad54bb1d51b6631c1f9557`: updated bootstrap tests for the supervised sandbox path.
- `c7f31c6c502f8e0d5ea6f917c1b6b90a38901849`: model container payload now excludes user IDs, lease tokens, storage paths and unrecognized request fields; only model-required generation fields cross the boundary.
- `54abb391a000e843668892783ddd147d197b41c6`: regression test verifies worker secrets and control-plane fields do not enter the container payload.
- `ed093cdfb7621ac00e164fca971f389d5926f283`: clarified the sandbox-only bootstrap test.
- Current branch head at this update: `ed093cdfb7621ac00e164fca971f389d5926f283`. PR #20 remains OPEN, DRAFT, NOT MERGED, base `feature/astra-cloud-memory`.

### Implemented
- Worker bootstrap no longer accepts arbitrary in-process model factories. The supported production route is a sandbox-backed adapter registry.
- Heartbeat cancellation and lease-loss events already feed the same cancellation event observed by the executor; the executor polls it and kills/removes the named container.
- The model container receives a minimal generation job, not the worker's lease token, owner ID or storage/control-plane metadata.
- Docker copy failures and successful cleanup failures are no longer silently treated as successful inference.
- Fixed a Wan runtime factory name mismatch that would have prevented the video runtime from initializing.

### Verification status
- GitHub Actions run `46148819094` was observed in progress at commit `54abb391a000e843668892783ddd147d197b41c6`; syntax checks had passed, while model-server tests were still running. A fresh workflow run for the latest head `ed093cdfb7621ac00e164fca971f389d5926f283` must be inspected before claiming the complete batch is green.
- No Docker host integration test, image build, GPU inference, model weight acquisition, moderation provider, deployment, migration application or generation activation has occurred.

### Remaining blockers before actual image/video generation
1. Finish bounded entrypoint result protocol: capture and validate the structured filename response and match it to the one copied output.
2. Add a separate GPU runtime Dockerfile and fully pinned compatible runtime dependencies; keep model weights out of the image.
3. Add lease-loss and cancellation integration tests that assert the Docker container is terminated before worker cleanup returns and no upload occurs after lease loss.
4. Run Docker host preflight on an authorized GPU host; verify the immutable runtime image digest and actual device/resource limits.
5. Have an adult account owner review/accept any gated model license and approve any compute/storage/bandwidth costs before acquiring weights or provisioning infrastructure.
6. Install a real reviewed moderation provider, run image and video quality/VRAM benchmarks, then perform one controlled image smoke test followed by one short-video smoke test.
7. Keep Cloudflare generation guard, queue flags, migrations 0010/0011, secrets and deployment unchanged until separately approved.



## 14. Sandbox-only bootstrap, bounded result IPC, and runtime image definition — 2026-11-28

### Additional commits
- `588e3dda46ea8e6ead6ee85042d50a3ddc02ea46` and `4b54830440880e67dbbacc1cbfce234315c385c3`: added a bounded 4 KiB JSON result protocol, drained concurrently to prevent stdout pipe backpressure, and required the reported filename to match the single file copied from `/outputs`.
- `ed0e6ba694d7bffa45e84bf734d43e19b96dc81c`: tests for filename mismatch and oversized result records.
- `46f27255492890861211442d5fe57cd8cfa5b94e`, `42ca0b75b1d6a1cf280c908175d3469f759cdef2`, `066664b4bd5af19d39f0e2fccaf204195db76b1e`, `39926c15a25865cb812866a9350c2153938c0e96`, `45e7b14ee48f2c14ce974ce3908bd63977be3474`: extracted a small standalone `runtime_errors.py` contract so the GPU runtime image does not need to import the entire API/worker dependency graph.
- `aac3be6c7cf0a302bd940c99ff72c1c10da50dae`: added the standalone error module.
- `a62609b06067836590b6a1fc8953fc3d2354741b` and `5d0484522c37e593364cca4cad5ff91dcedbd895`: added the runtime error module to CI compile coverage.
- `ba5d671dc59e3e2113c200473cf252dfd25b1c0b`: added pinned direct runtime dependency requirements.
- `ba933facc9a1a79dc317271463cde3512d31decb`: added a separate CUDA/PyTorch runtime Dockerfile that requires a digest-pinned base image, validates PyTorch/CUDA versions, installs dependencies, compiles trusted modules and imports runtime code. No weights are included.
- `4db30927ee6bbf32e838138bb8a039c8a8a17ab9`: documented the isolated runtime build and approval boundaries.
- `a6f78cf1784232d9f211791bd4f7c795ccc937cf`: clarified the sandbox-only bootstrap contract.
- `ebbc5b8f648973cc0abba65c708b3164c7f2785f` and `ad999cd676ea576f40b61a60d1aebaccdd6cf906`: added tests for sandbox mount mismatch and runtime/modality mismatch.
- Current PR head at this update: `ad999cd676ea576f40b61a60d1aebaccdd6cf906`. PR #20 remains OPEN, DRAFT, NOT MERGED, base `feature/astra-cloud-memory`.

### Verification
- CI run `46149196538` completed successfully on commit `ba933facc9a1a79dc317271463cde3512d31decb`: both syntax and model-server jobs passed; the model-server job ran 209 tests successfully, including the bounded result protocol, sandbox bootstrap integration and PostgreSQL 16 integration.
- That run's compile command did not yet include `runtime_errors.py`; the workflow compile list was corrected in `5d0484522c37e593364cca4cad5ff91dcedbd895`. The two additional regression tests were added afterward. A fresh CI run for the latest head must be checked before claiming those final additions are green.
- No Docker image build, Docker daemon host test, GPU execution, weights, model license acceptance, moderation provider, deployment or generation activation has occurred.

### Remaining work
1. Verify latest CI, including explicit compilation of `runtime_errors.py` and the newest sandbox registry tests.
2. Run a real Docker host integration test on a controlled Linux GPU host, including timeout, process cancellation, container kill/removal and output collection.
3. Verify the runtime Docker build against the selected immutable PyTorch/CUDA base digest; check exact Diffusers/PyTorch compatibility and the actual output codecs.
4. Implement or install a real reviewed moderation provider and validate its coverage before any output can be stored.
5. Add worker-level integration proving a heartbeat lease loss stops the running Docker container and prevents upload/completion.
6. Only after adult account-owner license and infrastructure-cost review, acquire local model artifacts, measure VRAM/latency, run one image smoke test and then one short-video smoke test.
7. Keep Worker generation guards, queue/worker flags, migrations 0010/0011, secrets, production and deployment untouched until explicit approval.


## 15. Opt-in real Docker host probe and final CI expansion — 2026-11-28

### Commits
- `4ee023cefe02bca28e8d49c9719ef192cf58db8b`: test-only sandbox entrypoint fixture that reads one probe request, writes one small output file, and returns the exact bounded result JSON.
- `1206bec821f9b29925b9b17a209e762f6853dc0b` and `5d7ea43b09a5e2bc88393cfc8b38e220e37e9d53`: fixture Dockerfile requires a digest-pinned Python base image and sets its import path for the supervisor's `python -m astra_sandbox_entrypoint` command.
- `9857fc99754b25081ce81a46c773e30d8dbfd32a`: added `test_sandbox_executor_docker.py`, skipped unless `ASTRA_DOCKER_INTEGRATION=1`, requiring an immutable fixture image digest and explicit numeric GPU device.
- `8ec170aa06c63060952db1765d55e1cd31ba0860`: added the opt-in host test to CI compile coverage.
- `f20800707f714dab72b534261e53e3f08fecc1b3`: documented fixture build and opt-in host test procedure.
- Current PR head at this checkpoint: `f20800707f714dab72b534261e53e3f08fecc1b3`; PR #20 remains OPEN, DRAFT, NOT MERGED, base `feature/astra-cloud-memory`.

### Verification
- CI run `46149455970` completed successfully at checkpoint `210dea279be17ee7d1f88115c66c08ca99684279`: syntax and model-server jobs passed; model-server reported 209 tests passing. It included sandbox bootstrap, bounded stdout/result matching, secret stripping, and PostgreSQL 16 integration.
- Runs `46149596427`, `46149600593`, and `46149615000` were observed in progress after adding the opt-in host fixture, its test module, and expanded compile list. Inspect the newest run before claiming the latest additions green.
- The opt-in Docker test is intentionally skipped in ordinary CI and has not been run against a real Docker/NVIDIA GPU host.
- Runtime Dockerfile has not been built. The selected PyTorch base image digest has not been supplied or verified. No weights, license acceptance, GPU host, moderation provider, deployment, production flags, or database migrations have been configured.

### Current technical state
- Worker bootstrap now requires the supervised Docker executor and never accepts arbitrary in-process generation factories.
- Lease heartbeat cancellation/loss is propagated through the worker cancellation event to the executor's container-kill path; worker checks lease loss before storage/completion.
- Container stdout is drained concurrently with a 4 KiB cap and parsed as exact JSON; returned filename must equal the single validated copied file.
- Model request payload excludes owner IDs, lease tokens, storage paths and unrecognized fields.
- Model runtime source is separated from the API/worker dependency graph through `runtime_errors.py`; a separate digest-pinned-base Dockerfile and pinned direct dependency list exist.
- Remaining blockers are real host/GPU integration, exact runtime dependency validation, real moderation-provider deployment, owner license/cost approval, model artifact installation and controlled inference benchmarks.
