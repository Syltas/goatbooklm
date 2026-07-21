-- Chat-origin notes: a note saved from a chat answer (or the empty-chat
-- notebook summary) is no longer flattened to literal-text paragraphs. It now
-- keeps its raw markdown AND the citation details that back the `[n]` markers,
-- so it can be rendered read-only with the EXACT same markdown + interactive
-- citation-chip stack the chat uses (`components/chat/citation-render.tsx`),
-- instead of the plain TipTap editor a hand-authored note gets.
--
-- No new table → no new RLS/grants: the existing `notes_owner` policy + the
-- table-level grants in 20260720120000_create_notes.sql already scope every
-- column, these new ones included.

alter table public.notes
  -- 'user' = hand-authored (edited in the TipTap editor), 'chat' = captured
  -- from a chat answer/summary (rendered read-only via markdown). Default keeps
  -- every existing row + every "Notiz hinzufügen" insert a 'user' note.
  add column if not exists origin text not null default 'user',
  -- Raw chat markdown for a 'chat' note — the string fed to the chat renderer.
  -- Null for a 'user' note (its body lives in `content` as TipTap JSON).
  add column if not exists markdown text,
  -- CitationDetail[] (see lib/chat/types.ts) backing the `[n]` markers, so the
  -- hover/click popover can show source title/passage/locator without a
  -- lookup. Null/[] for a note with no citations (e.g. the summary).
  add column if not exists citations jsonb;

-- Reject any origin value the app doesn't render (defense in depth — the
-- server action only ever writes 'user'/'chat', but the column is otherwise a
-- free-text field).
alter table public.notes
  drop constraint if exists notes_origin_check;
alter table public.notes
  add constraint notes_origin_check check (origin in ('user', 'chat'));
