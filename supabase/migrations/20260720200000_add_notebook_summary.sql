-- Notebook-level chat summary (empty-chat-state feature, Part A).
--
-- `summary` caches the notebook's corpus overview so the empty chat can show
-- it instantly (no cold-start LLM call while the user waits). `summary_stale`
-- is the "Gültigkeitsmarker" — a boolean rather than just relying on
-- `summary is null`, because a null-check alone can't distinguish "never
-- generated yet" from "was valid, then a source was deleted and the cached
-- text may now be wrong" while still letting the invalidator be a cheap
-- single-column flip (no LLM call on the delete path, see
-- `lib/notebooks/summary-service.ts`'s `invalidateNotebookSummary`). The
-- client only ever renders `summary` when `summary_stale = false` — a stale
-- (or never-generated) row falls back to today's generic empty-chat copy,
-- which is why `summary_stale` defaults to `true`: a notebook with no
-- generation attempt yet must render exactly like a "generation failed"
-- notebook, not like a false "valid empty string".
alter table public.notebooks
  add column if not exists summary text,
  add column if not exists summary_stale boolean not null default true;

-- No grant changes needed: `notebooks`'s grants (create_core_schema) are
-- table-level (`grant select, insert, update, delete on table
-- public.notebooks to authenticated/service_role`), so they already cover
-- every column including these two. RLS (`notebooks_owner`) scopes by
-- `user_id` alone and is likewise unaffected by adding columns.
