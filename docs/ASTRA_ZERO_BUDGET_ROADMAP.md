# ASTRA zero-budget, dual-mode delivery roadmap

**Status:** architecture plan; not a claim that model inference or public hosting is available.

## Product direction

ASTRA has two intended use cases:

1. **Internal ASTRALORE production:** controlled generation for the ASTRALORE content workflow.
2. **Public generation:** user-submitted image and video jobs through the ASTRALORE website.

Both modes must use the same trusted generation worker, model allowlist, artifact verification, moderation gates, output validation, private asset storage, and audit trail. They must not share identity, permissions, or resource quotas.

## Zero-upfront operating constraints

- No paid GPU rental, hosted inference API, paid moderation API, or paid subscription is assumed.
- Development and contract testing must work on CPU-only CI with synthetic fixtures.
- Free notebook GPUs may be used only for interactive experiments where the provider's current terms permit the activity. They are not treated as permanent servers, background workers, or a public production endpoint.
- Free-tier storage, bandwidth, and compute are best-effort and may be capped, unavailable, or changed by providers. Do not promise uptime or unlimited generation based on a free tier.
- Do not download large model weights until an authorized owner has reviewed model terms, chosen immutable revisions, and confirmed an appropriate storage and compute path.
- Do not accept model licences or other legal agreements on behalf of the project owner. Obtain appropriate adult review where required.

## Staged rollout

### Stage 0 — architecture and offline verification

- Keep the existing job queue, sandbox, manifest verification, private asset store, and moderation-provider boundary.
- Add explicit internal and public request origins to the API/job contract.
- Derive the origin and owner identity server-side; never trust a client-supplied role or owner ID.
- Keep public generation disabled by default.
- Exercise the full request lifecycle with mocked adapters and synthetic assets.

**Exit:** tests prove origin separation, authorization, quota isolation, and fail-closed behavior without model weights or GPU access.

### Stage 1 — internal-only inference experiment

- Obtain model artifacts only after owner licence review and a permitted source/revision decision.
- Prefer a small image-generation proof first; video is a separate later experiment because its memory, storage, and runtime requirements are substantially higher.
- Use a permitted, time-bounded free GPU notebook for manual experiments only. Do not expose notebook credentials or a notebook tunnel as a public API.
- Run the readiness validator and checksum verification before attempting any model load.
- Record measured VRAM, generation latency, output size, failures, and moderation outcomes.

**Exit:** one controlled image generation completes end-to-end on a permitted compute resource, with output moderation and private storage. This does not imply public availability.

### Stage 2 — public-mode readiness, still disabled

- Implement separate public authorization, per-user quotas, request-size limits, queue limits, and abuse controls.
- Enforce global capacity limits and a kill switch. When no permitted worker capacity exists, reject or queue requests transparently rather than promising generation.
- Apply prompt moderation before inference and output moderation before asset publication.
- Treat uncertain, unavailable, or malformed moderation responses as blocked/review-required; never fail open.
- Provide private-by-default assets, short-lived access links, deletion/retention controls, and safe error messages.
- Do not enable paid plans, collect payments, or promise service levels before legal, operational, and support requirements are reviewed.

**Exit:** security and abuse tests pass; the team has a stable, permitted compute source and an operational plan for outages and data handling.

### Stage 3 — limited public pilot

- Enable only after a stable compute source is confirmed and the owner explicitly approves activation.
- Start with a small invitation-only cohort and conservative per-user/global quotas.
- Monitor queue depth, GPU time, failure rates, moderation blocks/reviews, storage, and bandwidth.
- Keep a kill switch that disables new public jobs immediately without interrupting safe cleanup.

**Exit:** measured unit costs and reliability support a sustainable service. A free grant or trial is not assumed to be permanent.

## Model and moderation evaluation

- SD3.5 Medium and Wan2.1 T2V 1.3B remain candidates, not approved production dependencies.
- Validate exact immutable repository revisions and actual package layouts before staging.
- Review each model's current licence, commercial-use conditions, gated access, attribution, and any usage restrictions before use.
- Evaluate a self-hosted moderation model (including ShieldGemma candidates) against a documented test set for prompt and output coverage, false positives, false negatives, latency, memory, and video-frame handling.
- A moderation model is not automatically a complete safety system. Keep deterministic policy checks, rate limits, human review paths, and fail-closed behavior.

## Profitability reality

Zero upfront spending can support development, experiments, and a small grant-backed pilot. It cannot guarantee free production capacity or profit. Before any public commercial launch, calculate actual compute, storage, bandwidth, moderation, support, and compliance costs from measured usage. Do not sell unlimited generation against temporary free GPU quotas.

## Current status

- The codebase has queue, sandbox, manifest verification, model package readiness checks, private asset storage, and a moderation transport boundary.
- The model readiness tests use synthetic fixtures; the model profiles still need validation against exact authorized model revisions.
- No real model weights, GPU host, moderation classifier, inference result, or public generation capacity is currently provisioned.
- Public generation must remain disabled. No deployment, paid service, model download, licence acceptance, or PR merge is authorized by this roadmap.
