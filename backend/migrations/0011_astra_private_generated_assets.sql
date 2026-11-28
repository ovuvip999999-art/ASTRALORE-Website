-- ASTRA V2 private generated-media bucket.
-- No public access, user-facing policies, or signed URLs are created here.
-- The private model worker uses the server-side service_role credential only.
-- Apply manually only after reviewing the full ASTRA migration sequence.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'astra-generated-private',
  'astra-generated-private',
  false,
  536870912,
  array['image/png','image/jpeg','image/webp','video/mp4','video/webm']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- A restrictive policy prevents any broader permissive Storage policy from
-- accidentally granting anon/authenticated access to this private bucket.
-- service_role bypasses RLS in the Supabase project.
drop policy if exists "ASTRA generated assets remain server private" on storage.objects;
create policy "ASTRA generated assets remain server private"
  on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id <> 'astra-generated-private')
  with check (bucket_id <> 'astra-generated-private');

