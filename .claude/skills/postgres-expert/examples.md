# Database Examples

Complete, runnable examples for a per-user-ownership schema (a NotebookLM-style
app: users own notebooks, notebooks contain sources and notes). Every table
enables RLS with `revoke all` + `grant` + an owner policy in the same migration.

## Shared `updated_at` Trigger

Define this once in your first migration and reuse it everywhere.

```sql
-- supabase/migrations/<ts>_init_helpers.sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

## Profiles (mirror of auth.users)

A public profile row keyed by the auth user id. Users can only see and edit
their own profile.

```sql
-- supabase/migrations/<ts>_create_profiles.sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(255),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from authenticated, service_role;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

create policy "profiles_owner" on public.profiles
  for all to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
```

## Notebooks (top-level user-owned entity)

```sql
-- supabase/migrations/<ts>_create_notebooks.sql
create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title varchar(255) not null,
  description text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notebooks enable row level security;
revoke all on public.notebooks from authenticated, service_role;
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
```

## Sources (child of notebooks, ownership via parent)

Sources belong to a notebook. Rather than duplicate `user_id`, ownership is
enforced by checking the parent notebook. An enum tracks ingestion status.

```sql
-- supabase/migrations/<ts>_create_sources.sql
create type public.source_status as enum (
  'pending',
  'processing',
  'ready',
  'failed'
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  title varchar(255) not null,
  kind varchar(50) not null,            -- e.g. 'pdf', 'url', 'text'
  storage_path text,                     -- path in the 'sources' bucket
  status public.source_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sources enable row level security;
revoke all on public.sources from authenticated, service_role;
grant select, insert, update, delete on table public.sources to authenticated;
grant select, insert, update, delete on table public.sources to service_role;

-- Ownership flows through the parent notebook
create policy "sources_owner" on public.sources
  for all to authenticated
  using (
    exists (
      select 1 from public.notebooks n
      where n.id = sources.notebook_id and n.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.notebooks n
      where n.id = sources.notebook_id and n.user_id = auth.uid()
    )
  );

create trigger set_sources_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();

create index if not exists ix_sources_notebook_id on public.sources(notebook_id);
```

## Notes (child of notebooks)

```sql
-- supabase/migrations/<ts>_create_notes.sql
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;
revoke all on public.notes from authenticated, service_role;
grant select, insert, update, delete on table public.notes to authenticated;
grant select, insert, update, delete on table public.notes to service_role;

create policy "notes_owner" on public.notes
  for all to authenticated
  using (
    exists (
      select 1 from public.notebooks n
      where n.id = notes.notebook_id and n.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.notebooks n
      where n.id = notes.notebook_id and n.user_id = auth.uid()
    )
  );

create trigger set_notes_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

create index if not exists ix_notes_notebook_id on public.notes(notebook_id);
```

## Storage Bucket (per-user file namespace)

Files are stored under `<user_id>/...` so the policy can gate on the top folder.

```sql
-- supabase/migrations/<ts>_create_sources_bucket.sql
insert into storage.buckets (id, name, public)
values ('sources', 'sources', false)
on conflict (id) do nothing;

create policy "sources_bucket_owner" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

## Auto-create a Profile on Signup

A trigger on `auth.users` that inserts a matching profile row.

```sql
-- supabase/migrations/<ts>_profile_on_signup.sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

## PgTAP: Testing an RLS Policy

Verify that a user cannot read another user's notebook.

```sql
begin;
select plan(2);

-- Seed two users and one notebook owned by user A
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev');

insert into public.notebooks (id, user_id, title) values
  ('11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-00000000000a',
   'A''s notebook');

-- As user A: can see their own notebook
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.notebooks),
  1,
  'owner can read their own notebook'
);

-- As user B: cannot see user A's notebook
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';

select is(
  (select count(*)::int from public.notebooks),
  0,
  'non-owner cannot read the notebook'
);

select * from finish();
rollback;
```
