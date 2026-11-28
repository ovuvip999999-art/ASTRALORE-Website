# ASTRA model candidate review — 28 November 2026

Status: **evaluation candidates only; not production selections**.

This review records primary-source license and hardware notes before any weights are downloaded. It does not authorize model access, GPU execution, paid hosting, or production enablement.

## Image candidate

### Stability AI — Stable Diffusion 3.5 Medium

- Model ID: `stabilityai/stable-diffusion-3.5-medium`
- Task: text-to-image.
- License: Stability AI Community License, not Apache/MIT. The model card states free research/non-commercial/commercial use for individuals or organizations with less than USD 1 million in total annual revenue; above that threshold an Enterprise License is required.
- Access: the Hugging Face model card is gated and requires agreement to the license and acknowledgement of Stability AI's privacy policy. A parent/account owner must review the full current agreement and any account/data implications before accepting it or downloading weights.
- Hardware note: Stability AI's own release article reports 9.9 GB VRAM for SD 3.5 Medium excluding text encoders. Treat this as a vendor-reported baseline, not an ASTRA deployment guarantee. The full pipeline must be measured with all text encoders, VAE, precision, resolution, and concurrency settings.
- Primary sources:
  - Model card and license summary: https://huggingface.co/stabilityai/stable-diffusion-3.5-medium
  - Full license linked by the model card: https://huggingface.co/stabilityai/stable-diffusion-3.5-medium/blob/main/LICENSE.md
  - Stability AI hardware/license announcement: https://stability.ai/news-updates/introducing-stable-diffusion-3-5

Decision: **keep as the first image evaluation candidate, pending adult license review and a measured hardware budget**. Do not accept the gated terms or download weights as part of this code-only milestone.

## Video candidate

### Wan AI — Wan2.1 T2V 1.3B

- Model ID: `Wan-AI/Wan2.1-T2V-1.3B`
- Task: text-to-video, 480p baseline.
- License: Apache 2.0 according to the official model card and repository. Preserve required notices and review the complete license and model-specific terms before redistribution.
- Hardware note: the official model card reports 8.19 GB VRAM and approximately four minutes to generate a five-second 480p video on an RTX 4090 without quantization/optimizations. This is upstream-reported, not an ASTRA benchmark or a guarantee on other GPUs.
- Quality note: the official repository says the 1.3B checkpoint is primarily suitable for 480p; 720p results are less stable because of limited training at that resolution. This is a text-to-video checkpoint; do not treat it as a proven image-to-video solution.
- Primary sources:
  - Model card: https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B
  - Official repository and license: https://github.com/Wan-Video/Wan2.1

Decision: **keep as the first video evaluation candidate for 480p text-to-video**, pending exact revision pinning, dependency/security review, and measured hardware limits.

## Selection gates before any model runtime is enabled

1. Review the complete license text and redistribution/derivative obligations. For gated terms, an adult account owner must review and accept them; ASTRA must not automate acceptance.
2. Record the immutable upstream commit/revision and checksums for every model file and runtime dependency. Never load a floating `main` revision in production.
3. Confirm all model components (text encoders, VAE, tokenizer, schedulers, adapters) have compatible licenses and pinned revisions.
4. Measure peak VRAM, RAM, disk, generation latency, cold-start time, and cancellation behavior on the actual approved host.
5. Run the ASTRA blind benchmark pack with identical prompts/seeds/settings where possible; publish no quality claims until human ratings and artifact rates are reviewed.
6. Add per-modality hard timeouts, concurrency limits, queue caps, disk quotas, and an explicit no-cost/owner-approved infrastructure policy.
7. Keep generation disabled until all gates pass and the owner separately approves a deployment.

## Current ASTRA state

- No model weights have been downloaded.
- No model IDs are enabled in the server catalog by default.
- No GPU host, paid inference, or deployment is configured.
- The Cloudflare Worker fail-closed generation guard remains in place.
- These candidates do not make ASTRA an independently trained foundation model. ASTRA owns its orchestration and serving system; these would be self-hosted third-party open-weight models under their respective licenses.
