-- ASTRA V2: owner-only creative reservations with a combined estimated daily spend cap.
-- Reservations are server-calculated; clients cannot choose a cost or budget.
-- Estimates: FLUX.2 Klein 4B image reserve = $0.002; 5s 480p video reserve = $0.25.
-- Combined estimated daily reservation ceiling = $0.30 per account (UTC day).

alter table public.astra_creative_usage
  add column if not exists estimated_spend_usd numeric(10,6) not null default 0
  check (estimated_spend_usd >= 0);

create or replace function public.astra_reserve_creative_usage(
  p_user_id uuid,
  p_kind text
)
returns table (
  allowed boolean,
  remaining integer,
  budget_remaining_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_cost numeric(10,6);
  v_limit integer;
  v_images integer;
  v_videos integer;
  v_spent numeric(10,6);
  v_used integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  if p_kind = 'image' then
    v_cost := 0.002;
    v_limit := 3;
  elsif p_kind = 'video' then
    v_cost := 0.25;
    v_limit := 1;
  else
    raise exception 'Unsupported creative kind';
  end if;

  insert into public.astra_creative_usage (
    user_id, usage_date, images_generated, videos_generated, estimated_spend_usd, updated_at
  )
  values (
    p_user_id, v_today,
    case when p_kind = 'image' then 1 else 0 end,
    case when p_kind = 'video' then 1 else 0 end,
    v_cost, now()
  )
  on conflict (user_id, usage_date) do update
    set images_generated = public.astra_creative_usage.images_generated
          + case when p_kind = 'image' then 1 else 0 end,
        videos_generated = public.astra_creative_usage.videos_generated
          + case when p_kind = 'video' then 1 else 0 end,
        estimated_spend_usd = public.astra_creative_usage.estimated_spend_usd + v_cost,
        updated_at = now()
    where
      (case when p_kind = 'image'
        then public.astra_creative_usage.images_generated < 3
        else public.astra_creative_usage.videos_generated < 1
      end)
      and public.astra_creative_usage.estimated_spend_usd + v_cost <= 0.30
  returning images_generated, videos_generated, estimated_spend_usd
    into v_images, v_videos, v_spent;

  if not found then
    select images_generated, videos_generated, estimated_spend_usd
      into v_images, v_videos, v_spent
      from public.astra_creative_usage
      where user_id = p_user_id and usage_date = v_today;

    v_images := coalesce(v_images, 0);
    v_videos := coalesce(v_videos, 0);
    v_spent := coalesce(v_spent, 0);
    v_used := case when p_kind = 'image' then v_images else v_videos end;

    return query select
      false,
      greatest(0, v_limit - v_used),
      greatest(0::numeric, 0.30::numeric - v_spent);
    return;
  end if;

  v_used := case when p_kind = 'image' then v_images else v_videos end;
  return query select
    true,
    greatest(0, v_limit - v_used),
    greatest(0::numeric, 0.30::numeric - v_spent);
end;
$$;

revoke all on function public.astra_reserve_creative_usage(uuid, text) from public, anon;
grant execute on function public.astra_reserve_creative_usage(uuid, text) to authenticated;

-- Refund RPCs are deliberately not exposed to browser JWTs. Failed model calls keep
-- their reservation for the UTC day; this is conservative but prevents users from
-- repeatedly calling a public refund RPC to bypass daily limits.
revoke all on function public.astra_release_image_generation(uuid) from authenticated;
revoke all on function public.astra_release_video_generation(uuid) from authenticated;
