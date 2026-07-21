-- Studio-Artefakte (docs/specs/studio-quick-wins.md): EIN Datenmodell für
-- alle Studio-Outputs (Reports jetzt; Flash Cards, Quiz, Audio später —
-- neuer type + Prompt + Renderer, keine weitere Migration).
--
-- content-Shape pro type:
--   report:     {"markdown": "...", "truncated"?: true}
--   flashcards: {"cards":[{"front","back"}]}
--   quiz:       {"questions":[{"question","options":[4],"correct_index","explanation"}]}
--   audio:      {"storage_path","duration_s","voice"}

create table if not exists public.studio_artifacts (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('report', 'flashcards', 'quiz', 'audio')),
  format text check (format in ('briefing_doc', 'study_guide', 'blog_post')),
  title text not null,
  status text not null default 'generating'
    check (status in ('generating', 'ready', 'failed')),
  content jsonb,
  -- Snapshot der bei der Generierung verwendeten Quellen. v1 = alle
  -- ready-Quellen des Notebooks; Selection-Wiring kommt nach dem
  -- core-loop-v2-Merge ohne Schema-Bruch.
  source_ids uuid[] not null default '{}',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_artifacts_report_requires_format
    check (type <> 'report' or format is not null)
);

alter table public.studio_artifacts enable row level security;
revoke all on public.studio_artifacts from authenticated, service_role, anon;
grant select, insert, update, delete on table public.studio_artifacts to authenticated;
grant select, insert, update, delete on table public.studio_artifacts to service_role;

create policy "studio_artifacts_owner" on public.studio_artifacts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at trägt den Stale-Backstop der UI (generating > 5 min => als
-- fehlgeschlagen angezeigt) UND den Retry-Guard der Route — created_at wäre
-- nach einem Retry sofort wieder "stale".
create trigger set_studio_artifacts_updated_at
  before update on public.studio_artifacts
  for each row execute function public.set_updated_at();

create index if not exists ix_studio_artifacts_notebook_created
  on public.studio_artifacts(notebook_id, created_at desc);
create index if not exists ix_studio_artifacts_user_id
  on public.studio_artifacts(user_id);
