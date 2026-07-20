-- Multi-format ingestion: accept txt, md, docx, xlsx, csv and images
-- alongside the original pdf/text/web triple.
--
-- Two independent gates rejected a non-PDF upload before it could reach the
-- pipeline at all, and BOTH have to move for a new format to work:
--   1. `sources.type`'s CHECK constraint (below) — every insert of a new
--      type failed outright.
--   2. The `sources` Storage bucket's `allowed_mime_types` allowlist, which
--      held exactly `{application/pdf}` — the client uploads directly to
--      Storage, so a .docx was refused at the bucket before any row was
--      even touched.

-- ---------------------------------------------------------------------------
-- sources.type
-- ---------------------------------------------------------------------------

-- The original constraint was declared inline (`check (type in ('pdf',
-- 'text', 'web'))` in 20260719103134_create_core_schema.sql), so Postgres
-- auto-named it `sources_type_check`. Dropped and re-added rather than
-- altered — a CHECK constraint has no in-place ALTER form.
alter table public.sources drop constraint if exists sources_type_check;

alter table public.sources
  add constraint sources_type_check
  check (type in (
    'pdf', 'text', 'web',
    'txt', 'md', 'docx', 'xlsx', 'csv', 'image'
  ));

-- No grant changes needed: `sources`'s grants (create_core_schema) are
-- table-level (`grant select, insert, update, delete on table public.sources
-- to authenticated/service_role`), so they already cover every column and
-- are unaffected by a CHECK constraint change. RLS (`sources_owner`) is
-- likewise untouched — ownership is by `user_id`, not by type.

-- ---------------------------------------------------------------------------
-- sources storage bucket
-- ---------------------------------------------------------------------------

-- Mirrors `ALL_ALLOWED_MIME_TYPES` in `lib/ingestion/formats.ts`; keep the
-- two in sync when adding a format. `file_size_limit` is the LARGEST
-- per-type cap (PDF's 20MB) — this is a coarse backstop only. The precise,
-- per-type limit is enforced server-side on the actually-downloaded bytes in
-- `IngestionService.extractContent`, because a 20MB image and a 20MB PDF are
-- not the same thing and a single bucket-level number cannot express that.
update storage.buckets
set
  allowed_mime_types = array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'text/csv',
    'application/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'image/webp'
  ],
  file_size_limit = 20971520
where id = 'sources';

-- The bucket's own RLS policies (20260719144041_create_sources_storage_bucket.sql)
-- are unchanged and still correct for every new format: they scope access by
-- the first path segment (`{user_id}/...`), which is independent of the file
-- extension the path now ends in.
