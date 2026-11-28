-- ASTRA V2: durable generation job queue primitives.
-- This migration creates storage and atomic queue RPCs only.
-- It does NOT install models, start workers, enable generation, or deploy anything.
-- Apply manually in Supabase SQL Editor only after reviewing this migration.

create table if not exists public.astra_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  modality text not null check (modality in ('image', 'video')),
  model_id text not null check (char_length(model_id) between 1 and 128),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  request jsonb not null
    check (jsonb_typeof(request) = 'object' and pg_column_size(request) <= 32768),
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 128),
  attempts integer not null default 0 check (attempts between 0 and 3),
  max_attempts integer not null default 3 check (max_attempts = 3),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested boolean not null default false,
  output_asset jsonb,
  error_code text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint astra_generation_jobs_idempotency_unique unique (user_id, idempotency_key),
  constraint astra_generation_jobs_lease_consistency check (
    (status = 'running' and lease_owner is not null and lease_token is not null and lease_expires_at is not null)
    or
    (status <> 'running' and lease_owner is null and lease_token is null and lease_expires_at is null)
  ),
  constraint astra_generation_jobs_success_asset check (
    (status = 'succeeded' and output_asset is not null and error_code is null)
    or
    (status <> 'succeeded' and output_asset is null)
  ),
  constraint astra_generation_jobs_failure_code check (
    (status = 'failed' and error_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
    or
    (status <> 'failed' and error_code is null)
  ),
  constraint astra_generation_jobs_terminal_time check (
    (status in ('succeeded', 'failed', 'cancelled') and completed_at is not null)
    or
    (status in ('queued', 'running') and completed_at is null)
  )
);

create index if not exists astra_generation_jobs_queue_idx
  on public.astra_generation_jobs (available_at, created_at)
  where status = 'queued';

create index if not exists astra_generation_jobs_expired_lease_idx
  on public.astra_generation_jobs (lease_expires_at)
  where status = 'running';

create index if not exists astra_generation_jobs_user_history_idx
  on public.astra_generation_jobs (user_id, created_at desc);

alter table public.astra_generation_jobs enable row level security;

drop policy if exists "Users can read their own ASTRA generation jobs" on public.astra_generation_jobs;
create policy "Users can read their own ASTRA generation jobs"
  on public.astra_generation_jobs for select
  to authenticated using (auth.uid() = user_id);

revoke all on public.astra_generation_jobs from anon, authenticated;
grant select on public.astra_generation_jobs to authenticated;
grant select, insert, update on public.astra_generation_jobs to service_role;

-- Private server enqueue. Service role is the only role allowed to execute it.
-- Reusing an idempotency key with different request content is rejected.
create or replace function public.astra_enqueue_generation_job(
  p_user_id uuid,
  p_modality text,
  p_model_id text,
  p_request jsonb,
  p_idempotency_key text
)
returns public.astra_generation_jobs
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.astra_generation_jobs;
begin
  if p_user_id is null
     or p_modality not in ('image', 'video')
     or p_model_id is null or char_length(trim(p_model_id)) not between 1 and 128
     or jsonb_typeof(p_request) <> 'object'
     or pg_column_size(p_request) > 32768
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Invalid generation job request' using errcode = '22023';
  end if;

  insert into public.astra_generation_jobs
    (user_id, modality, model_id, request, idempotency_key)
  values
    (p_user_id, p_modality, trim(p_model_id), p_request, p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing
  returning * into v_job;

  if not found then
    select * into v_job
      from public.astra_generation_jobs
      where user_id = p_user_id and idempotency_key = p_idempotency_key
      for update;

    if v_job.modality <> p_modality
       or v_job.model_id <> trim(p_model_id)
       or v_job.request <> p_request then
      raise exception 'Idempotency key was already used for a different request'
        using errcode = '22023';
    end if;
  end if;

  return v_job;
end;
$$;

-- Atomic multi-worker claim. SKIP LOCKED prevents two workers claiming the same row.
-- Expired leases are requeued or terminally failed before the next claim batch.
create or replace function public.astra_claim_generation_jobs(
  p_worker_id text,
  p_batch_size integer default 1,
  p_lease_seconds integer default 120
)
returns setof public.astra_generation_jobs
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_worker_id is null or char_length(trim(p_worker_id)) not between 1 and 100
     or p_batch_size not between 1 and 4
     or p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid worker claim parameters' using errcode = '22023';
  end if;

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

  return query
  with picked as (
    select id
    from public.astra_generation_jobs
    where status = 'queued'
      and cancel_requested = false
      and available_at <= now()
      and attempts < max_attempts
    order by available_at, created_at
    for update skip locked
    limit p_batch_size
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

create or replace function public.astra_heartbeat_generation_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 120
)
returns table (cancel_requested boolean, lease_expires_at timestamptz)
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid lease duration' using errcode = '22023';
  end if;

  return query
  update public.astra_generation_jobs j
  set heartbeat_at = now(),
      lease_expires_at = case
        when j.cancel_requested then j.lease_expires_at
        else now() + make_interval(secs => p_lease_seconds)
      end,
      updated_at = now()
  where j.id = p_job_id
    and j.status = 'running'
    and j.lease_token = p_lease_token
    and j.lease_expires_at > now()
  returning j.cancel_requested, j.lease_expires_at;
end;
$$;

-- Worker completion accepts metadata only after the worker has inspected actual bytes.
-- This SQL validates shape and bounds; it cannot prove the bytes match the metadata.
create or replace function public.astra_complete_generation_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_output_asset jsonb
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.astra_generation_jobs;
  v_mime text;
  v_size bigint;
  v_width integer;
  v_height integer;
  v_duration integer;
begin
  select * into v_job
  from public.astra_generation_jobs
  where id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_expires_at > now()
  for update;

  if not found or v_job.cancel_requested then
    return false;
  end if;

  if jsonb_typeof(p_output_asset) <> 'object'
     or not (p_output_asset ?& array['asset_id','sha256','mime_type','size_bytes','width','height'])
     or (select count(*) from jsonb_object_keys(p_output_asset)) not in (6,7) then
    raise exception 'Invalid output asset metadata' using errcode = '22023';
  end if;

  v_mime := p_output_asset->>'mime_type';
  v_size := (p_output_asset->>'size_bytes')::bigint;
  v_width := (p_output_asset->>'width')::integer;
  v_height := (p_output_asset->>'height')::integer;

  if (p_output_asset->>'asset_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or (p_output_asset->>'sha256') !~* '^[0-9a-f]{64}$'
     or v_size not between 1 and 536870912
     or v_width not between 1 and 16384
     or v_height not between 1 and 16384
     or v_width::bigint * v_height::bigint > 100000000 then
    raise exception 'Output asset metadata exceeds safety bounds' using errcode = '22023';
  end if;

  if v_job.modality = 'image' then
    if v_mime not in ('image/png','image/jpeg','image/webp')
       or p_output_asset ? 'duration_ms' then
      raise exception 'Image output metadata does not match job modality' using errcode = '22023';
    end if;
  else
    if v_mime not in ('video/mp4','video/webm')
       or not (p_output_asset ? 'duration_ms') then
      raise exception 'Video output metadata does not match job modality' using errcode = '22023';
    end if;
    v_duration := (p_output_asset->>'duration_ms')::integer;
    if v_duration not between 1 and 120000 then
      raise exception 'Video duration exceeds safety bounds' using errcode = '22023';
    end if;
  end if;

  update public.astra_generation_jobs
  set status = 'succeeded',
      output_asset = p_output_asset,
      error_code = null,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id;

  return true;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid output asset metadata types' using errcode = '22023';
end;
$$;

create or replace function public.astra_fail_generation_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean default false
)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.astra_generation_jobs;
  v_next_status text;
begin
  if p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'Invalid safe error code' using errcode = '22023';
  end if;

  select * into v_job
  from public.astra_generation_jobs
  where id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_expires_at > now()
  for update;

  if not found then
    return 'lease_lost';
  end if;

  v_next_status := case
    when v_job.cancel_requested then 'cancelled'
    when p_retryable and v_job.attempts < v_job.max_attempts then 'queued'
    else 'failed'
  end;

  update public.astra_generation_jobs
  set status = v_next_status,
      available_at = case
        when v_next_status = 'queued'
          then now() + make_interval(secs => least(60, 5 * power(2, greatest(0, attempts - 1))::integer))
        else available_at
      end,
      error_code = case when v_next_status = 'failed' then p_error_code else null end,
      last_error_code = p_error_code,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      completed_at = case when v_next_status in ('failed','cancelled') then now() else null end,
      updated_at = now()
  where id = p_job_id;

  return v_next_status;
end;
$$;

-- User cancellation is owner-scoped. Queued jobs cancel immediately; running jobs
-- set a cooperative cancellation flag for the worker to observe on heartbeat.
create or replace function public.astra_cancel_generation_job(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.astra_generation_jobs;
begin
  if auth.uid() is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_job
  from public.astra_generation_jobs
  where id = p_job_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Generation job not found' using errcode = 'P0002';
  end if;

  if v_job.status = 'queued' then
    update public.astra_generation_jobs
    set status = 'cancelled', completed_at = now(), updated_at = now()
    where id = p_job_id;
    return 'cancelled';
  elsif v_job.status = 'running' then
    update public.astra_generation_jobs
    set cancel_requested = true, updated_at = now()
    where id = p_job_id;
    return 'cancellation_requested';
  end if;

  return v_job.status;
end;
$$;

revoke all on function public.astra_enqueue_generation_job(uuid,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.astra_claim_generation_jobs(text,integer,integer) from public, anon, authenticated;
revoke all on function public.astra_heartbeat_generation_job(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.astra_complete_generation_job(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.astra_fail_generation_job(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.astra_enqueue_generation_job(uuid,text,text,jsonb,text) to service_role;
grant execute on function public.astra_claim_generation_jobs(text,integer,integer) to service_role;
grant execute on function public.astra_heartbeat_generation_job(uuid,uuid,integer) to service_role;
grant execute on function public.astra_complete_generation_job(uuid,uuid,jsonb) to service_role;
grant execute on function public.astra_fail_generation_job(uuid,uuid,text,boolean) to service_role;

revoke all on function public.astra_cancel_generation_job(uuid) from public, anon;
grant execute on function public.astra_cancel_generation_job(uuid) to authenticated;

comment on table public.astra_generation_jobs is
  'Private durable ASTRA image/video job queue. Inference remains disabled until a reviewed worker and deployment are separately approved.';
