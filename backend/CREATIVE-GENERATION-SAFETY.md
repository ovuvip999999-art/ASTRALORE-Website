# ASTRA Creative Generation Safety

Creative generation remains disabled by default. Do not enable either Worker flag until the account owner has reviewed billing and explicitly approved preview testing.

## Required setup

1. Apply `migrations/0008_astra_creative_owner_budget.sql` in Supabase after migration 0007.
2. Set the Cloudflare Worker secret `ASTRA_CREATIVE_OWNER_USER_ID` separately for the preview Worker (and only later for production, if approved). Its value must be the UUID of the authorized owner in Supabase Auth. Never commit this value or place it in frontend code.
3. If the owner ID secret is missing or does not match the signed-in user's Supabase ID, creative requests return HTTP 403.
4. Keep `ASTRA_CREATIVE_ENABLED` and `ASTRA_VIDEO_ENABLED` set to `false` until the account owner has reviewed the model terms, current prices, and account billing.

## Server-enforced limits

- Image: up to 3 reservations per UTC day, reserving US$0.002 each.
- Video: up to 1 reservation per UTC day, reserving US$0.25.
- Combined estimated reservation ceiling: US$0.30 per owner account per UTC day.
- Costs and limits are hard-coded in the database function; the browser cannot supply a lower cost or a larger budget.
- The reservation is atomic and is kept for the day even if a model request fails. This conservative behavior avoids exposing a client-callable refund endpoint that could be abused to reset quotas.

These are **estimated usage reservations**, not a provider-side billing ceiling or guarantee of the final invoice. Model prices and billing rules can change. The Cloudflare account owner must review the live pricing and account-level billing controls before enabling generation. The code does not enable billing, change account settings, or deploy itself.
