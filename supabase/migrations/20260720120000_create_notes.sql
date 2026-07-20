-- Notes: user-authored notes scoped to one notebook. Same RLS discipline as
-- every other table in this schema (enable RLS + revoke + grant + owner
-- policy, all in this migration) — see 20260719103134_create_core_schema.sql.

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Notes are created empty (no create-form, unlike notebooks) — the title
  -- is edited inline afterwards, so a DB-level default covers the insert
  -- the same way `sources.status` defaults to 'pending'.
  title varchar(255) not null default 'Neue Notiz',
  -- Will hold TipTap JSON once the rich-text editor ships (follow-up
  -- section, not built here) — jsonb rather than text so the editor can
  -- read/write its document tree directly. '{}' is the "empty note" value
  -- until then.
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;
revoke all on public.notes from authenticated, service_role, anon;
grant select, insert, update, delete on table public.notes to authenticated;
grant select, insert, update, delete on table public.notes to service_role;

-- Mirrors `messages_owner`: `using` only needs the direct `user_id` check
-- (RLS scoping for select/update/delete), while `with check` additionally
-- confirms the referenced notebook is the same user's — otherwise a caller
-- could attach a note to someone else's notebook via a forged notebook_id.
create policy "notes_owner" on public.notes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notebooks n
      where n.id = notebook_id and n.user_id = auth.uid()
    )
  );

create trigger set_notes_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

create index if not exists ix_notes_notebook_id on public.notes(notebook_id);
create index if not exists ix_notes_user_id on public.notes(user_id);
