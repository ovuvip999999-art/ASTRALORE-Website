-- ASTRA access-mode separation.
-- This migration is intentionally NOT applied to any database by repository automation.
-- Existing jobs are classified as internal; public jobs must be created through the
-- server-authenticated public route after the API/Worker bridge is updated.

alter table public.astra_generation_jobs
  add column if not exists request_origin text not null default 'internal'
  check (request_origin in ('internal', 'public'));

create index if not exists astra_generation_jobs_origin_queue_idx
  on public.astra_generation_jobs (request_origin, available_at, created_at)
  where status = 'queued';

create index if not exists astra_generation_jobs_origin_user_history_idx
  on public.astra_generation_jobs (request_origin, user_id, created_at desc);

-- New RPC requires an explicit server-derived origin. The older enqueue RPC remains
-- available for backwards-compatible internal callers and defaults to internal.
create or replace function public.astra_enqueue_generation_job_v2(
  p_user_id uuid,
  p_modality text,
  p_model_id text,
  p_request jsonb,
  p_idempotency_key text,
  p_request_origin text
)
returns public.astra_generation_jobs
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.astra_generation_jobs;
  v_active_limit integer;
begin
  if p_user_id is null
     or p_modality is null or p_modality not in ('image', 'video')
     or p_request is null or jsonb_typeof(p_request) <> 'object'
     or pg_column_size(p_request) > 32768
     or p_model_id is null or char_length(trim(p_model_id)) not between 1 and 128
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128
     or p_request_origin is null or p_request_origin not in ('internal', 'public') then
    raise exception 'Invalid generation job request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(0, 10010);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_job
  from public.astra_generation_jobs
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_job.modality <> p_modality
       or v_job.model_id <> trim(p_model_id)
       or v_job.request <> p_request
       or v_job.request_origin <> p_request_origin then
      raise exception 'Idempotency key was already used for a different request'
        using errcode = '22023';
    end if;
    return v_job;
  end if;

  v_active_limit := case when p_request_origin = 'public' then 1 else 2 end;
  if (select count(*) from public.astra_generation_jobs
      where user_id = p_user_id
        and request_origin = p_request_origin
        and status in ('queued', 'running')) >= v_active_limit then
    raise exception 'Per-user active generation job limit reached' using errcode = '54000';
  end if;

  if (select count(*) from public.astra_generation_jobs
      where status in ('queued', 'running')) >= 100 then
    raise exception 'ASTRA generation queue is full' using errcode = '54000';
  end if;

  insert into public.astra_generation_jobs
    (user_id, modality, model_id, request, idempotency_key, request_origin)
  values
    (p_user_id, p_modality, trim(p_model_id), p_request, p_idempotency_key, p_request_origin)
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.astra_enqueue_generation_job_v2(uuid, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.astra_enqueue_generation_job_v2(uuid, text, text, jsonb, text, text) to service_role;
