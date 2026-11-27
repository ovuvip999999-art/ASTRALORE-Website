-- Preserve original PDF binaries for the visual editor.
-- Apply after 0003_astra_document_persistence.sql.
alter table public.astra_documents
  add column if not exists storage_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('astra-original-documents', 'astra-original-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf'];

drop policy if exists "ASTRA users can read own original PDFs" on storage.objects;
create policy "ASTRA users can read own original PDFs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'astra-original-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ASTRA users can upload own original PDFs" on storage.objects;
create policy "ASTRA users can upload own original PDFs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'astra-original-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ASTRA users can update own original PDFs" on storage.objects;
create policy "ASTRA users can update own original PDFs"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'astra-original-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'astra-original-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ASTRA users can delete own original PDFs" on storage.objects;
create policy "ASTRA users can delete own original PDFs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'astra-original-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
