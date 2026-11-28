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
