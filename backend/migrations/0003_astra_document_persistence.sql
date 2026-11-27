-- Persist the latest extracted document for each ASTRA cloud conversation.
-- The original binary is not retained; only extracted text and basic file metadata are stored.
create table if not exists public.astra_documents (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.astra_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) <= 240),
  mime_type text not null check (char_length(mime_type) <= 120),
  extracted_text text not null check (char_length(extracted_text) <= 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists astra_documents_user_conversation_idx
  on public.astra_documents (user_id, conversation_id);

alter table public.astra_documents enable row level security;

drop policy if exists "Users can read their own ASTRA documents" on public.astra_documents;
create policy "Users can read their own ASTRA documents"
  on public.astra_documents for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can insert their own ASTRA documents" on public.astra_documents;
create policy "Users can insert their own ASTRA documents"
  on public.astra_documents for insert
  to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.astra_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update their own ASTRA documents" on public.astra_documents;
create policy "Users can update their own ASTRA documents"
  on public.astra_documents for update
  to authenticated using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.astra_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete their own ASTRA documents" on public.astra_documents;
create policy "Users can delete their own ASTRA documents"
  on public.astra_documents for delete
  to authenticated using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.astra_documents to authenticated;
