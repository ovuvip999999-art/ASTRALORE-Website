# ASTRA V10 — Free AI backend

ASTRA uses Cloudflare Workers AI through the Worker AI binding. It does not require an OpenAI API key or a paid OpenAI API account.

## Free-plan limits
Cloudflare currently documents a free allocation of 10,000 Neurons per day for Workers AI on the Workers Free plan. The allowance is shared across AI usage on the account and resets daily at 00:00 UTC. When the free allowance is exhausted, AI requests stop working until it resets. Do not upgrade to a paid Workers plan if the goal is to keep this project at zero cost. Check the current Cloudflare pricing page before deployment because provider limits can change.

Official pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/

## Original PDF storage setup

Before testing the visual PDF editor, apply the SQL migrations in the Supabase SQL Editor in this order:
1. `backend/migrations/0004_astra_original_pdf_storage.sql`
2. `backend/migrations/0005_astra_pdf_editor_state.sql`

These create a private Storage bucket for original PDFs (10 MB limit, PDF only), owner-scoped Storage policies, and a JSON column for editor annotations. Do not make this bucket public. The browser uploads originals using the signed-in user's Supabase session; the Worker stores only the private object path and extracted text.

Existing documents uploaded before this setup remain text-only. Upload those PDFs again after the migrations to retain their original binary.

## Deploy
1. Have a parent/guardian review and oversee creation or use of the Cloudflare account and its settings.
2. Install Node.js on the computer if it is not already installed.
3. Open a terminal in this `backend` folder.
4. Run `npx wrangler login` and complete Cloudflare authorization with the account owner.
5. For the feature-branch preview, run `npx wrangler deploy --env preview`. This deploys the isolated `astralore-astra-api-preview` Worker. For production only, run `npx wrangler deploy`.
6. The website (Cloudflare Pages) and the AI Worker are separate deployments. A successful Pages preview does NOT automatically deploy the Worker. The preview website's `astra-config.js` must point to the preview Worker URL; production must point to the production Worker URL.
7. Keep the production Worker untouched while testing the feature branch. After the preview Worker has been deployed, test PDF upload, visual page rendering, text/cover annotations, cloud save, reload/restore, PDF export, and follow-up questions before merging the pull request.

No API key or payment secret is required by this Worker. Keep the Cloudflare account on its Free plan. Do not add a payment method or upgrade just to increase usage.

## Security and limitations
- The Worker accepts requests only from the ASTRALORE GitHub Pages origin and common local development origins.
- Request size and message lengths are capped; response length is limited.
- No third-party API key is stored in the repository or browser.
- This is a starter backend, not a complete abuse-prevention system. Public launch should include rate limiting and monitoring.
- The model answers from its model knowledge and conversation context. It does not yet search the web or have a curated, verified ASTRALORE video catalogue.
- Do not send personal or sensitive information to ASTRA.

Official setup guide: https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/
