-- Enforce origin-aware worker capacity in the database.
-- Defaults reserve two of four logical slots for internal work: public jobs can
-- occupy at most two slots, while internal work can use any otherwise-free slot.
-- These are logical concurrency limits, not a claim of dedicated physical GPUs.

create table if not exists public.astra_worker_capacity (
  singleton boolean primary key default true check (singleton),
  global_slots integer not null default 4 check (global_slots between 1 and 64),
  public_slots integer not null default 2 check (public_slots between 0 and 63),
  updated_at timestamptz not null default now(),
  constraint astra_worker_capacity_reserves_internal
    check (public_slots < global_slots)
);

insert into public.astra_worker_capacity (singleton, global_slots, public_slots)
values (true, 4, 2)
on conflict (singleton) do nothing;

alter table public.astra_worker_capacity enable row level security;
revoke all on public.astra_worker_capacity from public, anon, authenticated;
revoke all on public.astra_worker_capacity from service_role;
grant select, update on public.astra_worker_capacity to service_role;

create or replace function public.astra_claim_generation_jobs_v2(
  p_worker_id text,
  p_request_origin text,
  p_batch_size integer default 1,
  p_lease_seconds integer default 120
)
returns setof public.astra_generation_jobs
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_global_slots integer;
  v_public_slots integer;
  v_running_total integer;
  v_running_public integer;
  v_available integer;
begin
  if p_worker_id is null or char_length(trim(p_worker_id)) not between 1 and 100
     or p_request_origin is null or p_request_origin not in ('internal', 'public')
     or p_batch_size is null or p_batch_size not between 1 and 4
     or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid worker claim parameters' using errcode = '22023';
  end if;

  -- Serialize capacity accounting across both worker pools. Row locks on
  -- individual jobs alone cannot prevent concurrent claims oversubscribing
  -- the shared logical capacity.
  perform pg_advisory_xact_lock(0, 10011);

  select global_slots, public_slots
    into v_global_slots, v_public_slots
  from public.astra_worker_capacity
  where singleton = true
  for share;

  if not found then
    raise exception 'Worker capacity configuration is unavailable' using errcode = '55000';
  end if;

  -- Recover expired leases before calculating live occupancy.
  update public.astra_generation_jobs
  set status = case
        when cancel_requested then 'cancelled'
        when attempts >= max_attempts then 'failed'
        else 'queued'
      end,
      error_code = case
        when cancel_requested then null
        when attempts >= max_attempts then 'WORKER_LEASE_EXPIRED'
        else null
      end,
      last_error_code = case
        when cancel_requested then last_error_code
        else 'WORKER_LEASE_EXPIRED'
      end,
      completed_at = case
        when cancel_requested or attempts >= max_attempts then now()
        else null
      end,
      available_at = case
        when cancel_requested or attempts >= max_attempts then available_at
        else now() + interval '5 seconds'
      end,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where status = 'running' and lease_expires_at < now();

  select count(*)::integer,
         count(*) filter (where request_origin = 'public')::integer
    into v_running_total, v_running_public
  from public.astra_generation_jobs
  where status = 'running';

  if p_request_origin = 'public' then
    v_available := least(v_global_slots - v_running_total,
                         v_public_slots - v_running_public);
  else
    -- Internal workers may use all free slots, including otherwise-idle
    -- public capacity. Public workers can never exceed public_slots, which
    -- leaves global_slots - public_slots reserved when public is saturated.
    v_available := v_global_slots - v_running_total;
  end if;

  if v_available <= 0 then
    return;
  end if;

  return query
  with picked as (
    select id
    from public.astra_generation_jobs
    where status = 'queued'
      and request_origin = p_request_origin
      and cancel_requested = false
      and available_at <= now()
      and attempts < max_attempts
    order by available_at, created_at
    limit least(p_batch_size, v_available)
    for update skip locked
  )
  update public.astra_generation_jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      lease_owner = trim(p_worker_id),
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

revoke all on function public.astra_claim_generation_jobs_v2(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.astra_claim_generation_jobs_v2(text, text, integer, integer) to service_role;
