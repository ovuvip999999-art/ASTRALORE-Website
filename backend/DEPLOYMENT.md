# ASTRA V9 — Live AI backend

This repository contains the ASTRALORE website frontend and a Cloudflare Worker backend.

## Current state
- The website is connection-ready.
- The frontend uses local sample replies until `window.ASTRA_API_URL` is set in `astra-config.js`.
- The Worker calls the OpenAI Responses API. The API key belongs only in the Worker secret store, never in GitHub or browser JavaScript.

## Before activating live AI
API usage may cost money. A parent/guardian should review the provider account, billing, usage limits, and deployment before any paid API is enabled. Do not paste API keys into chat, GitHub files, screenshots, or the website.

## Deploy the Worker
1. A parent/guardian should create/review the Cloudflare account and Worker.
2. Install Wrangler on a trusted computer and sign in to the Cloudflare account.
3. From this `backend` folder, deploy with `npx wrangler deploy`.
4. Add the secret interactively: `npx wrangler secret put OPENAI_API_KEY`. Paste the key only into the secure terminal prompt. Never put it in a command line, source file, or chat.
5. Optional model override: set a Worker variable named `ASTRA_MODEL` in Cloudflare if you want a different model; the default is `gpt-5.5`.
6. Copy the deployed Worker HTTPS URL.
7. Put that URL into `astra-config.js` as the value of `window.ASTRA_API_URL`, commit the change, and publish the GitHub Pages update.

## Security notes
- CORS allows only the ASTRALORE GitHub Pages origin and common local development origins.
- Requests are size-limited, message lengths are capped, and output length is limited.
- The API key is read from the Worker secret binding `OPENAI_API_KEY`.
- This is a starter backend, not a complete abuse-prevention system. Before public launch, add Cloudflare rate limiting / abuse controls and set provider spending limits.
- The Worker does not enable web search or external tools. ASTRA answers from model knowledge and the conversation only; ASTRALORE video recommendations/verified channel knowledge need a separate curated content catalogue.
- Requests use `store: false`; do not send personal or sensitive information to the assistant.

Official API reference: https://developers.openai.com/api/reference/resources/responses/methods/create
