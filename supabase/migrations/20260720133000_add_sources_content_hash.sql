-- Content-hash dedupe for `sources` (multi-PDF upload + dedupe feature).
--
-- Real incident this responds to: two sources in one notebook
-- ("Briefing-VZUG-16.07" / "Briefing-Legienhof-16.07") both showed
-- "Bereit" but held byte-identical PDF bytes under two different titles —
-- a client-side title/file mismatch (fixed separately in
-- `pdf-upload-tab.tsx`) went undetected because nothing ever compared the
-- actual file content. This migration adds the column + constraint that
-- makes that class of bug structurally impossible going forward.

-- Nullable, not backfilled: every source ingested before this migration has
-- no known hash of its original bytes — only extracted `content_text` is
-- stored, never the raw file, and there is no `storage_path` for non-PDF
-- sources to re-hash from at all. Existing rows simply opt out of dedupe
-- (their `content_hash` stays NULL unless re-uploaded) rather than being
-- backfilled out of band. This is safe re: task 7's constraint below:
-- Postgres treats every NULL in a unique index as distinct from every other
-- NULL, so any number of legacy NULL-hash rows can coexist under the same
-- `notebook_id` without ever tripping it.
alter table public.sources add column content_hash text;

-- `sources`'s existing grants (20260719103134_create_core_schema.sql) are
-- table-level (`grant select, insert, update, delete on table
-- public.sources to authenticated/service_role`) — those automatically
-- cover this new column, no grant changes needed here.

-- The actual dedupe enforcement: two sources in the same notebook can never
-- share a non-null content_hash. A pure application-level SELECT-then-INSERT
-- check (see `lib/ingestion/service.ts`'s `createPendingPdfSource`) is a
-- TOCTOU race on its own — two concurrent uploads of the same file both
-- pass the SELECT before either INSERT lands — so the real guarantee has to
-- live here, at the constraint level; the application-level check is only a
-- best-effort UX shortcut (naming the existing source without needing to
-- lose an insert-then-catch round trip in the common, non-racing case).
alter table public.sources
  add constraint sources_notebook_id_content_hash_key
  unique (notebook_id, content_hash);
