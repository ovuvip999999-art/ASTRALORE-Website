-- ASTRA V2 plan entitlements and rolling 24-hour creative quotas.
-- Owner image generation bypasses reservations in the Worker after Supabase auth verification.
-- Premium image entitlement is stored here and can only be changed by the account administrator
-- through the Supabase SQL editor/service role; browser clients have read-only access to their own plan.

create table if not exists public.astra_user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  updated_at timestamptz not null default now()
);

alter table public.astra_user_plans enable row level security;
revoke all on public.astra_user_plans from anon, authenticated;
grant select on public.astra_user_plans to authenticated;
drop policy if exists "Users can read their own ASTRA plan" on public.astra_user_plans;
create policy "Users can read their own ASTRA plan"
  on public.astra_user_plans for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.astra_creative_generation_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  estimated_cost_usd numeric(10,6) not null check (estimated_cost_usd >= 0),
  generated_at timestamptz not null default now()
);

create index if not exists astra_creative_events_user_kind_time_idx
  on public.astra_creative_generation_events (user_id, kind, generated_at desc);

alter table public.astra_creative_generation_events enable row level security;
revoke all on public.astra_creative_generation_events from anon, authenticated;

drop function if exists public.astra_reserve_creative_usage(uuid, text);

create function public.astra_reserve_creative_usage(
  p_user_id uuid,
  p_kind text
)
returns table (
  allowed boolean,
  remaining integer,
  budget_remaining_usd numeric,
  unlimited boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := 10;
  v_used integer := 0;
  v_is_premium boolean := false;
  v_cost numeric(10,6);
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  if p_kind not in ('image', 'video') then
    raise exception 'Unsupported creative kind';
  end if;

  v_cost := case when p_kind = 'image' then 0.002 else 0.25 end;

  -- Serialize reservations for this account and generation type to prevent parallel quota bypass.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_kind));

  if p_kind = 'image' then
    select exists (
      select 1 from public.astra_user_plans
      where user_id = p_user_id and plan = 'premium'
    ) into v_is_premium;
  end if;

  if p_kind = 'image' and v_is_premium then
    insert into public.astra_creative_generation_events (user_id, kind, estimated_cost_usd)
    values (p_user_id, p_kind, v_cost);
    return query select true, null::integer, null::numeric, true;
    return;
  end if;

  select count(*)::integer
    into v_used
    from public.astra_creative_generation_events
    where user_id = p_user_id
      and kind = p_kind
      and generated_at > now() - interval '24 hours';

  if v_used >= v_limit then
    return query select false, 0, null::numeric, false;
    return;
  end if;

  -- Reserve before calling the model. Failed model calls retain the reservation for 24 hours.
  insert into public.astra_creative_generation_events (user_id, kind, estimated_cost_usd)
  values (p_user_id, p_kind, v_cost);

  return query select true, greatest(0, v_limit - v_used - 1), null::numeric, false;
end;
$$;

revoke all on function public.astra_reserve_creative_usage(uuid, text) from public, anon;
grant execute on function public.astra_reserve_creative_usage(uuid, text) to authenticated;

-- Existing refund RPCs stay revoked; clients cannot reset their rolling limits.
revoke all on function public.astra_release_image_generation(uuid) from public, anon, authenticated;
revoke all on function public.astra_release_video_generation(uuid) from public, anon, authenticated;
