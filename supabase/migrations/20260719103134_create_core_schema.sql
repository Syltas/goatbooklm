-- Core schema for GoatbookLM: notebooks, sources, chunks, messages.
-- pgvector-backed RAG over user-owned notebooks. Every table enables RLS
-- with revoke + grant + owner policy in this same migration.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger function
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- notebooks
-- ---------------------------------------------------------------------------

create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title varchar(255) not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notebooks enable row level security;
revoke all on public.notebooks from authenticated, service_role, anon;
grant select, insert, update, delete on table public.notebooks to authenticated;
grant select, insert, update, delete on table public.notebooks to service_role;

create policy "notebooks_owner" on public.notebooks
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_notebooks_updated_at
  before update on public.notebooks
  for each row execute function public.set_updated_at();

create index if not exists ix_notebooks_user_id on public.notebooks(user_id);

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('pdf', 'text', 'web')),
  title varchar(500) not null,
  url text,
  storage_path text,
  content_text text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sources enable row level security;
revoke all on public.sources from authenticated, service_role, anon;
grant select, insert, update, delete on table public.sources to authenticated;
grant select, insert, update, delete on table public.sources to service_role;

create policy "sources_owner" on public.sources
  for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notebooks n
      where n.id = notebook_id and n.user_id = auth.uid()
    )
  );

create trigger set_sources_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();

create index if not exists ix_sources_notebook_id on public.sources(notebook_id);
create index if not exists ix_sources_user_id on public.sources(user_id);

-- ---------------------------------------------------------------------------
-- chunks
-- ---------------------------------------------------------------------------

create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

alter table public.chunks enable row level security;
revoke all on public.chunks from authenticated, service_role, anon;
grant select, insert, update, delete on table public.chunks to authenticated;
grant select, insert, update, delete on table public.chunks to service_role;

create policy "chunks_owner" on public.chunks
  for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notebooks n
      where n.id = notebook_id and n.user_id = auth.uid()
    )
    and exists (
      select 1 from public.sources s
      where s.id = source_id and s.user_id = auth.uid()
    )
  );

create index if not exists ix_chunks_source_id on public.chunks(source_id);
create index if not exists ix_chunks_notebook_id on public.chunks(notebook_id);
create index if not exists ix_chunks_user_id on public.chunks(user_id);
create index if not exists ix_chunks_embedding_hnsw
  on public.chunks using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;
revoke all on public.messages from authenticated, service_role, anon;
grant select, insert, update, delete on table public.messages to authenticated;
grant select, insert, update, delete on table public.messages to service_role;

create policy "messages_owner" on public.messages
  for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.notebooks n
      where n.id = notebook_id and n.user_id = auth.uid()
    )
  );

create index if not exists ix_messages_notebook_id on public.messages(notebook_id);
create index if not exists ix_messages_user_id on public.messages(user_id);
create index if not exists ix_messages_notebook_id_created_at on public.messages(notebook_id, created_at);
