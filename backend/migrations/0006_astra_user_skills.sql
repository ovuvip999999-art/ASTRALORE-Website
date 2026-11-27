-- ASTRA V2: private, account-scoped Markdown skills.
-- Skill contents are stored as text in Postgres; RLS keeps each user's skills private.

create table if not exists public.astra_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 300),
  content text not null check (char_length(content) between 1 and 20000),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists astra_skills_user_enabled_updated_idx
  on public.astra_skills (user_id, enabled, updated_at desc);

alter table public.astra_skills enable row level security;

drop policy if exists "Users can read their own ASTRA skills" on public.astra_skills;
create policy "Users can read their own ASTRA skills"
  on public.astra_skills for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can create their own ASTRA skills" on public.astra_skills;
create policy "Users can create their own ASTRA skills"
  on public.astra_skills for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update their own ASTRA skills" on public.astra_skills;
create policy "Users can update their own ASTRA skills"
  on public.astra_skills for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own ASTRA skills" on public.astra_skills;
create policy "Users can delete their own ASTRA skills"
  on public.astra_skills for delete
  to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.astra_skills to authenticated;
