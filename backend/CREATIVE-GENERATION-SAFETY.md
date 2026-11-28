# ASTRA Creative Generation Plans & Safety

## Zero-cost launch status

**Image and video generation are paused in code.** The Worker rejects every creative-generation request before reaching either model. The Image Studio and Video Studio buttons are disabled in the interface.

This is intentional: Cloudflare's free daily Workers AI allowance is shared across ASTRA's other AI traffic too. The Worker cannot currently read and reserve the account's remaining provider Neurons with a reliable hard guarantee. A per-user image quota or an estimated per-image cost is not sufficient to guarantee zero charges. The current video provider is paid per generated second.

## Current safeguards

- `ASTRA_CREATIVE_ENABLED` and `ASTRA_VIDEO_ENABLED` remain `false` in the checked-in Wrangler configuration.
- A code-level fail-closed guard rejects all creative actions even if either feature flag is accidentally changed.
- The owner unlimited-image bypass and premium unlimited-image entitlement are unreachable while this guard is active.
- No video model request can be made through the Worker.
- Do not apply migrations `0008_astra_creative_owner_budget.sql` or `0009_astra_free_and_premium_plans.sql`; they belong to the earlier paid/quota design and are not part of the zero-cost launch.
- Existing Skills, chat, document features, and their current configuration are unchanged.

## What must be built before re-enabling images

1. A shared, server-enforced daily budget that accounts for all Workers AI usage, not just image requests.
2. A reliable way to know the account's actual remaining free Neurons and enforce a conservative reserve.
3. A fail-closed response when usage data is missing, stale, or the allowance is exhausted.
4. Tests proving parallel requests cannot exceed the shared budget.
5. Confirmation that the Cloudflare account remains on a plan where exceeding the daily free allowance does not create paid usage.

A per-user limit such as 10 images/day is not a provider spending cap. Premium and owner unlimited generation must remain disabled until operating costs are covered by verified revenue and the account owner explicitly approves paid usage.

## Deployment status

These are repository changes only. They do not apply Supabase migrations, change Cloudflare billing, deploy a Worker or Pages site, or enable paid generation. Keep PR #20 open, draft, and unmerged; keep production untouched.
