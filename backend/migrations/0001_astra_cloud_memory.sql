-- ASTRA cloud conversation archive
-- Apply in the Supabase SQL Editor. Uses Supabase Auth users as account owners.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.astra_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists astra_conversations_user_updated_idx
  on public.astra_conversations (user_id, updated_at desc);

create table if not exists public.astra_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.astra_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 30000),
  sequence_no bigint not null,
  created_at timestamptz not null default now(),
  search_document tsvector generated always as (
    to_tsvector('simple', coalesce(content, ''))
  ) stored,
  embedding vector(768),
  unique (conversation_id, sequence_no)
);

create index if not exists astra_messages_user_conversation_sequence_idx
  on public.astra_messages (user_id, conversation_id, sequence_no);
create index if not exists astra_messages_search_idx
  on public.astra_messages using gin (search_document);
create index if not exists astra_messages_embedding_idx
  on public.astra_messages using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

alter table public.astra_conversations enable row level security;
alter table public.astra_messages enable row level security;

drop policy if exists "Users can read their own ASTRA conversations" on public.astra_conversations;
create policy "Users can read their own ASTRA conversations"
  on public.astra_conversations for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can insert their own ASTRA conversations" on public.astra_conversations;
create policy "Users can insert their own ASTRA conversations"
  on public.astra_conversations for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update their own ASTRA conversations" on public.astra_conversations;
create policy "Users can update their own ASTRA conversations"
  on public.astra_conversations for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own ASTRA conversations" on public.astra_conversations;
create policy "Users can delete their own ASTRA conversations"
  on public.astra_conversations for delete
  to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can read their own ASTRA messages" on public.astra_messages;
create policy "Users can read their own ASTRA messages"
  on public.astra_messages for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can insert their own ASTRA messages" on public.astra_messages;
create policy "Users can insert their own ASTRA messages"
  on public.astra_messages for insert
  to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.astra_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete their own ASTRA messages" on public.astra_messages;
create policy "Users can delete their own ASTRA messages"
  on public.astra_messages for delete
  to authenticated using (auth.uid() = user_id);

-- Authenticated full-text retrieval. The function independently checks auth.uid(),
-- so a user can search only their own messages even if they alter the RPC arguments.
create or replace function public.astra_search_messages(
  p_user_id uuid,
  p_query text,
  p_limit integer default 12
)
returns table (
  message_id uuid,
  conversation_id uuid,
  role text,
  content text,
  created_at timestamptz,
  rank real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id,
    m.conversation_id,
    m.role,
    m.content,
    m.created_at,
    ts_rank(m.search_document, websearch_to_tsquery('simple', left(coalesce(p_query, ''), 300))) as rank
  from public.astra_messages m
  where auth.uid() = p_user_id
    and m.user_id = p_user_id
    and length(trim(coalesce(p_query, ''))) > 0
    and m.search_document @@ websearch_to_tsquery('simple', left(p_query, 300))
  order by rank desc, m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 30));
$$;

revoke all on function public.astra_search_messages(uuid, text, integer) from public, anon;
grant execute on function public.astra_search_messages(uuid, text, integer) to authenticated;

-- The RPC is safe for authenticated clients because auth.uid() must match p_user_id.
-- All table access remains subject to the per-user RLS policies above.
