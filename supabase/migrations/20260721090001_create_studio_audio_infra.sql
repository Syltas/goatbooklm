-- Studio-Audio-Infrastruktur (docs/specs/studio-audio.md, Approach B):
-- pgmq-Queue + service_role-RPCs + Worker-Config + pg_cron-Trigger + Bucket.
-- 1:1 die Muster aus 20260719144042_create_ingestion_queue.sql /
-- 20260719150855_expose_pgmq_rpc.sql / 20260719144041_create_sources_storage_bucket.sql.

select pgmq.create('studio_audio');   -- payload shape: { "artifact_id": "<uuid>" }

-- ---------------------------------------------------------------------------
-- RPC-Wrapper — service_role ONLY (gleiche C1-Begründung wie Ingestion:
-- pgmq kennt keine Row-Ownership; enqueue läuft im Action-/Route-Layer über
-- den Admin-Client, strikt NACH dem RLS-scoped Ownership-Check).
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_studio_audio_job(payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact_id uuid;
begin
  v_artifact_id := (payload->>'artifact_id')::uuid;
  if v_artifact_id is null then
    raise exception 'enqueue_studio_audio_job: payload.artifact_id is required';
  end if;

  return pgmq.send('studio_audio', payload);
end;
$$;

create or replace function public.read_studio_audio_jobs(p_vt integer default 600, p_qty integer default 1)
returns table (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language sql
security definer
set search_path = ''
as $$
  select msg_id, read_ct, enqueued_at, vt, message
  from pgmq.read('studio_audio', p_vt, p_qty);
$$;

create or replace function public.delete_studio_audio_job(msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.delete('studio_audio', msg_id);
$$;

revoke all on function public.enqueue_studio_audio_job(jsonb) from public, anon, authenticated;
revoke all on function public.read_studio_audio_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.delete_studio_audio_job(bigint) from public, anon, authenticated;

grant execute on function public.enqueue_studio_audio_job(jsonb) to service_role;
grant execute on function public.read_studio_audio_jobs(integer, integer) to service_role;
grant execute on function public.delete_studio_audio_job(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- studio_worker_config — Singleton (URL + Secret für den pg_cron-Trigger).
-- RLS enabled, null Policies, kein Grant an authenticated/anon: nur
-- BYPASSRLS-Rollen (service_role/postgres) lesen. Lokale Row via seed.sql,
-- Prod via manuellem UPDATE (Runbook wie ingestion_worker_config).
-- ---------------------------------------------------------------------------

create table public.studio_worker_config (
  id boolean primary key default true,
  url text not null,
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_worker_config_singleton check (id)
);

comment on table public.studio_worker_config is
  'Singleton row (id always true): Studio-Audio-Worker-Endpoint + Shared Secret für den pg_cron->pg_net-Trigger. service_role/postgres only. Lokale Row via supabase/seed.sql; Prod via manuellem SQL UPDATE.';

alter table public.studio_worker_config enable row level security;
revoke all on public.studio_worker_config from authenticated, service_role, anon;
grant select on public.studio_worker_config to service_role;

create trigger set_studio_worker_config_updated_at
  before update on public.studio_worker_config
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pg_cron: alle 15s POST auf die Worker-Route (pg_cron >=1.5 verifiziert,
-- siehe Ingestion-Migration).
-- ---------------------------------------------------------------------------

-- timeout_milliseconds: pg_nets 5s-Default würde jeden arbeitenden Tick
-- (Skript ~30-60s) mitten in der Verbindung kappen — Node arbeitet zwar
-- weiter, aber 120s halten die Verbindung für die Antwort offen (Logs in
-- net._http_response bleiben aussagekräftig statt "Timeout reached").
select cron.schedule(
  'studio-audio-worker-tick',
  '15 seconds',
  $$
  select net.http_post(
    url := c.url,
    headers := jsonb_build_object(
      'x-worker-secret', c.secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  from public.studio_worker_config c;
  $$
);

-- ---------------------------------------------------------------------------
-- Storage-Bucket studio-audio: privat, nur MP3, 50 MB. Uploads macht
-- AUSSCHLIESSLICH der Worker über den Admin-Client (BYPASSRLS) — deshalb
-- bewusst KEINE insert/update-Policies für authenticated (Review-Fix R1-6:
-- User-Uploads in den Bucket wären reine Missbrauchsfläche). User lesen
-- (Signed URL) und löschen owner-scoped über den Pfad-Präfix.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-audio', 'studio-audio', false, 52428800, array['audio/mpeg'])
on conflict (id) do nothing;

create policy "studio_audio_bucket_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'studio-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "studio_audio_bucket_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'studio-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
