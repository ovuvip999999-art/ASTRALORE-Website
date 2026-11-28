# ASTRA Creative Engine — Model and Quality Roadmap

Status: design and evaluation plan. No model weights are bundled, no model is downloaded, and no inference endpoint is enabled by this document.

## Product target

ASTRA should be a model-independent creative engine, not a thin wrapper around a single generation API. The product owns the prompt workflow, orchestration, job lifecycle, storage, safety checks, model selection, consistency tools, and quality evaluation. Model weights may be open-source and self-hosted. ASTRA must not claim that a model is "better than" another system without repeatable, task-matched evaluations.

## Architecture

1. **Creative brief compiler** — turn a user's brief into a structured plan: subject, action, environment, composition, camera, lighting, palette, materials, style, aspect ratio, and constraints. Preserve the user's intent; do not silently add conflicting details.
2. **Model router** — select an approved image or video runtime by task, capability, available VRAM, and measured quality. No external provider fallback.
3. **Inference workers** — separate image and video workers, each with bounded concurrency, memory limits, timeouts, and explicit model/version identity.
4. **Consistency layer** — reusable character/reference images, style profiles, seed and generation metadata, shot continuity notes, and optional image-to-video conditioning when supported by the selected model.
5. **Post-processing** — safe resizing/upscaling, format conversion, metadata capture, and quality checks. Never upscale and describe it as native detail.
6. **Job and asset service** — authenticated asynchronous jobs, progress states, cancellation, private object storage, signed short-lived download links, and per-user ownership checks.
7. **Evaluation harness** — fixed prompt suite, blinded human ratings, automated technical checks, latency and VRAM tracking, and regression comparisons for every model or runtime change.

## Initial model candidates (not final selections)

### Image: Stable Diffusion 3.5 Medium

- Official model: `stabilityai/stable-diffusion-3.5-medium`
- Model card describes MMDiT-X, multi-resolution training, prompt understanding and image-quality improvements.
- License: Stability AI Community License. It permits commercial use under its stated conditions, including the annual-revenue threshold; legal review is required before ASTRA is used commercially.
- The model card recommends Diffusers or ComfyUI for self-hosting and mentions Skip Layer Guidance for improved structure/anatomy coherence.
- This is a candidate for the first image runtime, not a guarantee of top-tier results. Benchmark it against alternatives before locking it in.
- Official model card: https://huggingface.co/stabilityai/stable-diffusion-3.5-medium
- License: https://stability.ai/license

### Video: Wan2.1

- Official repository: `Wan-Video/Wan2.1`
- Repository license: Apache-2.0.
- The project lists 1.3B and 14B variants, text-to-video and image-to-video tasks, and different resolution trade-offs.
- The project reports about 8.19 GB VRAM for its 1.3B model and around four minutes for a five-second 480p clip on an RTX 4090 without optimisations. These are upstream-reported figures, not ASTRA benchmarks or a promise of speed.
- Start with a low-cost local smoke test only on suitable GPU hardware; evaluate visual stability before considering larger variants.
- Official repository: https://github.com/Wan-Video/Wan2.1

## Premium quality rubric

Every candidate must be tested on the same prompt set and scored from 1–5 by blinded reviewers:

- Prompt fidelity: required subjects, actions, objects, and constraints are present.
- Composition: framing, visual hierarchy, perspective, and readable silhouettes.
- Anatomy/object integrity: coherent hands, faces, limbs, geometry, and physical structure.
- Lighting/materials: believable light direction, shadows, reflections, and surface response.
- Style consistency: stable visual language across a batch or sequence.
- Text rendering: spelling and layout when the prompt requests visible text.
- Video temporal coherence: identity, clothing, geometry, and scene continuity across frames.
- Motion quality: plausible movement, camera motion, and transitions without distracting flicker.
- Artifact rate: visible defects and failed generations.
- Operational quality: latency, peak VRAM, failure rate, output size, and reproducibility.

A release candidate needs strong average human scores, no severe regression in any critical dimension, reproducible settings, and a documented model/license review. Do not select models from demo images alone.

## First benchmark pack

Use at least 30 prompts per modality, with a balanced mix of:
- cinematic environments and landscapes;
- detailed character portraits and full-body scenes;
- multiple subjects interacting;
- difficult composition and camera instructions;
- typography and graphic layouts;
- varied lighting, weather, and materials;
- image-to-video character motion and camera movement;
- short narrative shots requiring continuity.

Store prompt text, model ID/revision, runtime version, seed, dimensions, sampler/settings, generation time, peak VRAM, and output checksum with each result. Keep human ratings separate from model metadata.

## Compute and zero-cost policy

- Self-hosting removes dependence on a third-party generation API; it does not make GPU inference free.
- No GPU host, paid service, paid API, or billing change is authorized by this plan.
- Do not download large model weights automatically.
- Do not enable generation until the server has a real runtime, authentication, bounded job queue, storage policy, abuse controls, and a verified shared resource budget.
- Keep the Worker fail-closed guard in place until all those checks pass.
- Never expose model-server tokens or private endpoints to browser code.

## Milestones

1. **Foundation (current):** private FastAPI contract, authentication, container scaffold, tests, provider adapter, and fail-closed Worker guard.
2. **Model qualification:** confirm license terms, pin model revisions, document GPU/RAM/disk needs, and benchmark candidate models on suitable hardware.
3. **Image runtime:** implement lazy model loading, GPU capability checks, bounded concurrency, deterministic metadata, output validation, and integration tests.
4. **Video runtime:** implement a separate asynchronous worker and job lifecycle; video must not block image generation or ASTRA chat.
5. **Creative orchestration:** prompt compiler, reference/character consistency, storyboard-to-shot workflow, and controlled post-processing.
6. **Release gate:** blind quality evaluation, security review, cost/resource caps, and explicit owner approval before any deployment.

## Current truth

The model server is still a scaffold. Its image/video routes intentionally return HTTP 503. No image or video model is installed, no generation has been tested, and no deployment is authorized.