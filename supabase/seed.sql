-- Local-only dev seed data, applied by `supabase db reset` (see
-- supabase/config.toml [db.seed]). This file is NOT part of the migration
-- history and is never replayed against a remote/prod database via
-- `supabase db push` — that's the whole point of keeping the ingestion
-- worker secret out of supabase/migrations/*.sql.

-- Ingestion worker config (Spec 02 §8): points pg_cron's HTTP trigger at the
-- local Next.js dev server. `host.docker.internal` because the schedule runs
-- inside the supabase_db_goatbooklm container and must reach the host
-- machine, not "localhost" (which would resolve inside the container).
--
-- The 3100 below is only the DEFAULT (this machine's own dev server
-- intentionally runs there — see playwright.config.ts's comment: port 3000
-- is occupied by an unrelated project). A different machine/setup overrides
-- it via the INGESTION_WORKER_URL env var WITHOUT editing this file — run
-- `node scripts/apply-ingestion-worker-url.mjs` after `supabase db reset`
-- (see that script and .env.example). The override can't live in THIS file:
-- `supabase db reset` sends seed.sql to Postgres as a plain SQL batch
-- (confirmed empirically — no psql, no `env()` config.toml-style
-- interpolation, no OS-env-var access from inside a raw SQL statement is
-- available here), so the override necessarily runs as a separate, optional
-- pass afterward instead.
--
-- Eng-Review L3: the secret is generated fresh on every `supabase db reset`
-- via `gen_random_uuid()` rather than a hardcoded literal — a literal here
-- would be a plaintext secret checked into the repo (this file IS
-- version-controlled, unlike .env.local), even though it only ever governs
-- a local dev stack. The worker Route Handler
-- (app/api/ingestion-worker/route.ts) reads the current value straight out
-- of this table on every request, so there's nothing else to keep in sync —
-- no `INGESTION_WORKER_SECRET` env var to copy it into anymore.
insert into public.ingestion_worker_config (id, url, secret)
values (
  true,
  'http://host.docker.internal:3100/api/ingestion-worker',
  gen_random_uuid()::text
)
on conflict (id) do update set
  url = excluded.url,
  secret = excluded.secret,
  updated_at = now();
