-- Async ingestion queue (Spec 02 — Source-Ingestion, §4 Punkt 1, §7, §8).
-- Add-Source actions enqueue a job and return immediately; a pg_cron-triggered
-- worker (app/api/ingestion-worker/route.ts, built separately) drains the
-- queue on a fixed schedule via pg_net HTTP calls. See specs/02-ingestion.md.

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

select pgmq.create('ingestion_jobs');   -- payload shape: { "source_id": "<uuid>" }

-- pgmq's internal tables (pgmq.q_ingestion_jobs etc.) live outside the exposed
-- API schemas (supabase/config.toml [api] schemas = ["public","graphql_public"]),
-- so they are unreachable via PostgREST/the client SDK regardless of grants.
-- pgmq.send/read/delete are only ever called service-side: from
-- createAdminClient() (service-role) in the Add-Source actions and the worker
-- route handler — never directly from a user session or client RPC.

-- ---------------------------------------------------------------------------
-- ingestion_worker_config
--
-- Holds the worker endpoint URL + shared secret that the pg_cron job POSTs to
-- every tick. This is infrastructure config, not a user-owned resource, and
-- the secret must never be readable by authenticated/anon. RLS is enabled
-- with NO policies and NO grant to authenticated/anon — only BYPASSRLS roles
-- (service_role, postgres; both confirmed BYPASSRLS in this project's local
-- Postgres) can read it, and only the table owner (postgres, who created it
-- in this migration) can write it.
--
-- The local dev row (url + secret) is seeded via supabase/seed.sql, NOT this
-- migration, so no secret value ever lands in migration history (migrations
-- are the one artifact that gets replayed against every environment,
-- including a future prod `supabase db push`; seed.sql only runs on local
-- `supabase db reset`, see supabase/config.toml [db.seed]).
--
-- Prod deploy: after this migration runs against the prod DB, set the real
-- Vercel URL + a freshly generated secret with a manual SQL UPDATE, e.g.
--   update public.ingestion_worker_config
--   set url = 'https://<your-app>.vercel.app/api/ingestion-worker',
--       secret = gen_random_uuid()::text
--   where id = true;
-- Never commit the prod secret value anywhere. Eng-Review L3: the worker
-- Route Handler (app/api/ingestion-worker/route.ts) reads this row's
-- `secret` column directly (short-TTL in-memory cache) on every request —
-- there is no `INGESTION_WORKER_SECRET` env var to also keep in sync
-- anymore, this UPDATE is the only place the value needs to be set.
-- ---------------------------------------------------------------------------

create table public.ingestion_worker_config (
  id boolean primary key default true,
  url text not null,
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingestion_worker_config_singleton check (id)
);

comment on table public.ingestion_worker_config is
  'Singleton row (id always true) holding the ingestion worker endpoint URL + shared secret used by the pg_cron -> pg_net HTTP trigger. service_role/postgres only — see migration header comment. Local dev row seeded via supabase/seed.sql; prod row set via manual SQL UPDATE post-deploy.';

alter table public.ingestion_worker_config enable row level security;
revoke all on public.ingestion_worker_config from authenticated, service_role, anon;
grant select on public.ingestion_worker_config to service_role;
-- Deliberately: no grant to authenticated/anon, no policies at all. A table
-- with RLS enabled and zero policies denies all access to every role except
-- BYPASSRLS roles and the owner — that's the point here.

create trigger set_ingestion_worker_config_updated_at
  before update on public.ingestion_worker_config
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pg_cron schedule
--
-- Ticks every 15 seconds. pg_cron's sub-minute ('N seconds') schedule syntax
-- requires pg_cron >=1.5; verified locally on pg_cron 1.6.4
-- (`select extversion from pg_extension where extname = 'pg_cron';`). If ever
-- deployed against an older pg_cron (<1.5), fall back to the standard
-- '* * * * *' (every minute) cron syntax instead — not needed here.
--
-- The job runs as the role that scheduled it (postgres, since this migration
-- runs as postgres), which is BYPASSRLS, so it can read
-- ingestion_worker_config despite the table having zero RLS policies.
-- ---------------------------------------------------------------------------

select cron.schedule(
  'ingestion-worker-tick',
  '15 seconds',
  $$
  select net.http_post(
    url := c.url,
    headers := jsonb_build_object(
      'x-worker-secret', c.secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  from public.ingestion_worker_config c;
  $$
);
