-- Storage bucket for PDF source uploads (Spec 02 — Source-Ingestion, §8/§9).
-- Private bucket, owner-only via path-prefix RLS: {user_id}/{source_id}.pdf.
-- Client uploads directly to Storage (bypasses the Server-Action body-size limit,
-- see Spec 02 §4 Punkt 2) — RLS on storage.objects is what makes this safe.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sources', 'sources', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase itself; we only add policies
-- here (no revoke/grant — those are managed by the storage extension, not this app).
-- Owner-only via first path segment = auth.uid(). No update policy: a re-upload is
-- always a new source (new storage_path), never an in-place file replace (Spec 02 §8).

create policy "sources_bucket_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "sources_bucket_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "sources_bucket_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
