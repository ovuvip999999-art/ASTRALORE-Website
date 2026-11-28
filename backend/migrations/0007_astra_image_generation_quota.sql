-- ASTRA V2: server-enforced daily image-generation allowance.
-- Three generated images per authenticated account per UTC database date.

create table if not exists public.astra_creative_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  images_generated integer not null default 0 check (images_generated >= 0),
  videos_generated integer not null default 0 check (videos_generated >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.astra_creative_usage add column if not exists videos_generated integer not null default 0 check (videos_generated >= 0);
alter table public.astra_creative_usage enable row level security;
revoke all on public.astra_creative_usage from anon, authenticated;

create or replace function public.astra_consume_image_generation(p_user_id uuid)
returns table (allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  insert into public.astra_creative_usage (user_id, usage_date, images_generated, updated_at)
  values (p_user_id, v_today, 1, now())
  on conflict (user_id, usage_date) do update
    set images_generated = public.astra_creative_usage.images_generated + 1,
        updated_at = now()
    where public.astra_creative_usage.images_generated < 3
  returning images_generated into v_used;

  if not found then
    return query select false, 0;
  else
    return query select true, greatest(0, 3 - v_used);
  end if;
end;
$$;

revoke all on function public.astra_consume_image_generation(uuid) from public, anon;
grant execute on function public.astra_consume_image_generation(uuid) to authenticated;

create or replace function public.astra_release_image_generation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  update public.astra_creative_usage
    set images_generated = greatest(0, images_generated - 1),
        updated_at = now()
    where user_id = p_user_id
      and usage_date = (now() at time zone 'utc')::date;
end;
$$;

revoke all on function public.astra_release_image_generation(uuid) from public, anon;
grant execute on function public.astra_release_image_generation(uuid) to authenticated;

create or replace function public.astra_consume_video_generation(p_user_id uuid)
returns table (allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  insert into public.astra_creative_usage (user_id, usage_date, videos_generated, updated_at)
  values (p_user_id, v_today, 1, now())
  on conflict (user_id, usage_date) do update
    set videos_generated = public.astra_creative_usage.videos_generated + 1,
        updated_at = now()
    where public.astra_creative_usage.videos_generated < 1
  returning videos_generated into v_used;

  if not found then
    return query select false, 0;
  else
    return query select true, greatest(0, 1 - v_used);
  end if;
end;
$$;

revoke all on function public.astra_consume_video_generation(uuid) from public, anon;
grant execute on function public.astra_consume_video_generation(uuid) to authenticated;

create or replace function public.astra_release_video_generation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  update public.astra_creative_usage
    set videos_generated = greatest(0, videos_generated - 1),
        updated_at = now()
    where user_id = p_user_id
      and usage_date = (now() at time zone 'utc')::date;
end;
$$;

revoke all on function public.astra_release_video_generation(uuid) from public, anon;
grant execute on function public.astra_release_video_generation(uuid) to authenticated;
