-- Persist visual PDF editor annotations with the conversation's document.
alter table public.astra_documents
  add column if not exists editor_state jsonb not null default '{"annotations":[]}'::jsonb;
