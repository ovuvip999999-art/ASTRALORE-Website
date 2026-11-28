# ASTRA Creative Studio — Provider Architecture & Safety

## Current status

**Image and video generation remain paused.** The Worker-level fail-closed guard rejects creative requests before any provider adapter can be called. Both Studio buttons remain disabled.

No provider has been selected in Wrangler configuration. The provider registry returns no adapter when the provider ID is missing or unknown; it never silently falls back.

## Provider-independent architecture

- The browser talks only to the authenticated ASTRA Worker.
- The Worker selects image and video providers independently using `ASTRA_IMAGE_PROVIDER` and `ASTRA_VIDEO_PROVIDER`.
- Provider-specific request/response handling lives in `backend/creative-providers.js`.
- The initial Cloudflare Workers AI adapter is retained as a reference implementation, not an enabled recommendation.
- A future provider can be added as another adapter without changing the Studio UI.
- Provider adapters report their cost basis. Neuron-metered image usage and per-second video pricing must not be treated as interchangeable or assumed free.

## Provider research snapshot — 28 November 2026

The provider boundary is intentionally not tied to one vendor, but current free API options are limited:

- Cloudflare Workers AI documents 10,000 Neurons/day at no charge. Its pricing documentation says usage beyond that allowance requires the Workers Paid plan; the account plan and account-wide consumption still need verification before ASTRA can rely on it as a no-charge route. [Official pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
- Hugging Face's current pricing documentation lists no monthly Inference Provider credits for Free accounts. [Official pricing](https://huggingface.co/docs/inference-providers/main/pricing).
- Google's current Gemini image-generation model pricing lists no free API tier for those image models. [Official pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Wan is an open model, but self-hosting is not equivalent to free hosted inference. The Wan2.1 project reports about 8.19 GB VRAM for its 1.3B text-to-video model. [Official model repository](https://github.com/Wan-Video/Wan2.1).

**Current decision:** keep Cloudflare as an optional image-provider adapter, not a mandatory dependency. Do not add a hosted provider whose free tier cannot be verified. Keep video paused until a genuinely no-cost hosting route is available or an account owner explicitly approves a funded option.

## Why generation is still blocked

A provider adapter is not a spending-control system. We do not yet have a reliable shared budget that measures and reserves the real cost across all ASTRA image and video requests. Cloudflare's free Workers AI allowance is shared with other account AI traffic, and the current video model has a per-second price.

A per-user generation counter is not proof that provider usage is free. Do not enable any provider until its current free tier, rate limits, billing behavior, and usage measurement are verified.

## Required work before activation

1. Research current providers and official pricing/free-tier terms separately for image and video.
2. Add adapters only for providers with an acceptable verified cost model.
3. Implement one atomic server-side budget covering both modalities, with modality-specific cost estimates.
4. Ensure reservations are made before provider calls; fail closed on stale or unavailable usage data.
5. Test concurrent requests, provider failures, retries, malformed responses, and budget exhaustion.
6. Keep video disabled if no genuinely free and sustainable route exists.

## Safeguards

- `ASTRA_CREATIVE_ENABLED` and `ASTRA_VIDEO_ENABLED` remain `false`.
- The Worker-level creative guard remains active even if feature flags are changed accidentally.
- No owner or premium unlimited bypass is approved.
- Do not apply migrations `0008_astra_creative_owner_budget.sql` or `0009_astra_free_and_premium_plans.sql`; they belong to the superseded paid/quota design.
- No billing changes, provider credentials, migrations, or production deployment are part of this work.

## Deployment

Repository changes only. Keep PR #20 open, draft, and unmerged. Production remains untouched.
