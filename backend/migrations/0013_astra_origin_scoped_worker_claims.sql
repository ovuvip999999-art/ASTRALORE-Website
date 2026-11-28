-- Replace the all-origin worker claim RPC with an origin-scoped claim.
-- Worker origin is derived by worker_api.py from a distinct server-side token;
-- this function is service-role-only and rejects any value outside the two modes.

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
begin
  if p_worker_id is null or char_length(trim(p_worker_id)) not between 1 and 100
     or p_request_origin is null or p_request_origin not in ('internal', 'public')
     or p_batch_size is null or p_batch_size not between 1 and 4
     or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid worker claim parameters' using errcode = '22023';
  end if;

  -- Expired leases are safely recovered regardless of origin. This is state
  -- maintenance only; the subsequent claim selection remains origin-filtered.
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
      and request_origin = p_request_origin
      and cancel_requested = false
      and available_at <= now()
      and attempts < max_attempts
    order by available_at, created_at
    limit p_batch_size
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

-- Remove the old all-origin RPC so no stale server caller can bypass the new
-- origin boundary. The queue-store adapter now uses only the v2 signature.
drop function if exists public.astra_claim_generation_jobs(text, integer, integer);
