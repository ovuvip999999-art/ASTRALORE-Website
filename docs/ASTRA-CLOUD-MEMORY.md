# ASTRA cloud memory architecture (v1)

## Goal
Persist every conversation message in a cloud account archive and make prior conversations available to new chats. The archive is the source of truth; summaries or extracted memories are optional indexes, never replacements for the original messages.

## Initial stack
- Supabase Auth: account creation, sign-in, session refresh and sign-out.
- Supabase Postgres: full conversation and message archive.
- PostgreSQL full-text search: retrieve exact/relevant older messages.
- pgvector: reserved for semantic retrieval embeddings (768 dimensions); embeddings are optional until the Worker embedding pipeline is implemented and validated.
- Cloudflare Worker: verifies Supabase access tokens, enforces request limits, persists messages, retrieves relevant prior messages, and calls Workers AI.
- Browser/PWA/Android WebView: holds only the short-lived auth session and UI state; never holds the service-role key.

## Data guarantees
- Each user owns conversations and messages through `user_id`.
- RLS is enabled on both tables. Browser clients can only read/write rows whose `user_id` matches `auth.uid()`.
- The Worker must verify every access token with Supabase Auth before trusting its user ID.
- The initial implementation uses the user's Supabase access token plus the public publishable key for Worker database requests. The Worker verifies the token with Supabase Auth, and Postgres RLS enforces user isolation. Do not use a service-role key for ordinary chat/archive operations.
- Full messages are retained independently from AI context windows. Retrieval sends only a bounded, relevant selection to the model.
- Provide account-level export and permanent delete controls before public launch.
- Do not store passwords, payment details, government identifiers, or sensitive personal/health information as extracted memory. Users should be warned not to share secrets.

## SQL setup
Apply `backend/migrations/0001_astra_cloud_memory.sql` in the Supabase SQL Editor. The migration creates:
- `astra_conversations`
- `astra_messages`
- user-scoped RLS policies
- full-text search index
- optional 768-dimensional vector index
- server-only `astra_search_messages` RPC

## Required deployment configuration (not yet set)
Browser-safe values:
- `ASTRA_SUPABASE_URL`
- `ASTRA_SUPABASE_ANON_KEY`

Cloudflare Worker variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

No service-role key is required for the initial chat/archive flow. The Worker verifies the user's access token and uses that same token for RLS-protected database calls.

The Worker must not be deployed with placeholder values. The user must create the Supabase project and configure secrets through the Supabase/Cloudflare dashboards. Never ask the user to paste the service-role key into chat or commit it to Git.

## Implementation sequence
1. Create Supabase project and apply the SQL migration.
2. Add Supabase Auth UI and session handling to ASTRA.
3. Add Worker access-token verification and per-user message persistence using the user's JWT and RLS.
4. Add archive list/open/search from cloud data.
5. Add cross-chat retrieval (full-text first, semantic retrieval after embedding tests).
6. Add export/delete-account flows, abuse controls, retention controls and tests.
7. Verify browser, PWA and Android WebView sign-in and history sync before production rollout.

## Current limitation
This branch contains the initial database schema and architecture plan only. It does not yet implement login, Worker token verification, cloud persistence, or cloud retrieval. Do not advertise cloud memory as active until those pieces are deployed and tested.
