# ASTRA Creative Generation Plans & Safety

Creative generation remains disabled by default. These plan rules are enforced by the authenticated Worker and Supabase database, not by browser-only UI controls.

## Plans

- **Owner:** unlimited image generation at no per-generation charge to the owner. Owner identity is matched against the private Worker secret `ASTRA_CREATIVE_OWNER_USER_ID`. Owner videos use the standard 10-per-rolling-24-hour allowance.
- **Free users:** 10 images and 10 videos in any rolling 24-hour window. Users pay nothing per generated image or video through ASTRA; the Cloudflare account owner still bears provider usage costs.
- **Premium users:** unlimited images. Premium videos remain limited to 10 in a rolling 24-hour window.

A generation is reserved before calling the model. If a model request fails, the reservation remains for 24 hours to prevent retries from bypassing the limit. The rolling window means an individual generation slot becomes available 24 hours after that reservation, rather than resetting at midnight.

## Required setup

1. Apply migrations `0006_astra_user_skills.sql`, `0007_astra_image_generation_quota.sql`, `0008_astra_creative_owner_budget.sql`, then `0009_astra_free_and_premium_plans.sql` in Supabase SQL Editor. Migration 0009 replaces the interim 0008 reservation function.
2. Set `ASTRA_CREATIVE_OWNER_USER_ID` as a Cloudflare Worker secret for the preview Worker using the owner's Supabase Auth UUID. Never commit it or place it in frontend code.
3. Premium membership is stored in `public.astra_user_plans`. It is read-only to browser users; the account administrator assigns/removes Premium using the Supabase SQL Editor. Example assignment:

   ```sql
   insert into public.astra_user_plans (user_id, plan)
   values ('CUSTOMER_SUPABASE_AUTH_UUID', 'premium')
   on conflict (user_id) do update
   set plan = 'premium', updated_at = now();
   ```

   To return a user to Free:

   ```sql
   update public.astra_user_plans
   set plan = 'free', updated_at = now()
   where user_id = 'CUSTOMER_SUPABASE_AUTH_UUID';
   ```

4. Keep `ASTRA_CREATIVE_ENABLED` and `ASTRA_VIDEO_ENABLED` set to `false` until the Cloudflare account owner has reviewed current model prices, account billing controls, and explicitly approved preview testing.

## Cost and abuse safeguards

- Free image allowance: 10 per rolling 24 hours; estimated model cost is reserved at US$0.002 per image.
- Premium/owner image generation is unlimited by application quota. It is **not free to operate**: the Cloudflare account owner pays provider usage costs.
- Video allowance: 10 per rolling 24 hours; the existing 5-second 480p model request is estimated at US$0.25 each.
- Premium payments, subscription checkout, automatic renewal, and payment webhooks are not implemented in this change. Premium entitlement is manually administered until a payment provider is integrated.
- These estimates are not a provider-side spending cap or invoice guarantee. Unlimited generation can create substantial usage charges. Review provider billing controls before enabling it.

The code changes do not enable billing, change Cloudflare account settings, apply database migrations, or deploy themselves. Keep production untouched.
