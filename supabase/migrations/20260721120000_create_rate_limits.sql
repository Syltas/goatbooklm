-- Server-side rate limiting for the two paid-AI endpoints
-- (POST /api/chat, POST /api/studio/generate). Vercel serverless runs many
-- concurrent instances, so an in-memory limiter is useless — the counter has
-- to live in Postgres, shared across every instance. This is a Postgres-backed
-- FIXED-WINDOW limiter: one counter row per (user, bucket, window), incremented
-- and checked atomically inside a single security-definer function. No Redis /
-- Upstash / external vendor, no new npm dependency.
--
-- Buckets in use (see lib/ratelimit/index.ts — the single source of truth for
-- the limits): 'chat', 'studio_generate', 'studio_audio'. The column is plain
-- text (no check constraint): the bucket value is chosen server-side from a
-- typed union, never from client input, and keeping it open-text means adding
-- a new bucket needs no schema change.

-- ---------------------------------------------------------------------------
-- rate_limits — one row per (user_id, bucket, window_start). `count` is the
-- number of requests seen in that fixed window. Old windows are simply never
-- touched again; a periodic cleanup (pg_cron `delete from public.rate_limits
-- where window_start < now() - interval '1 day'`, plus an index on
-- window_start) is deliberately left as future work — stale rows are harmless
-- and tiny, and the hot path only ever touches the current window's row by PK.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, bucket, window_start)
);

-- NON-NEGOTIABLE table rules (CLAUDE.md §Security 1), all in this migration:
-- enable RLS + revoke all + grant only what's needed.
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated, service_role;

-- Intentionally NO DML grants to `authenticated` and NO SELECT policy: this
-- table is written EXCLUSIVELY through the security-definer check_rate_limit()
-- function below. That function runs as its owner (the migration role, which
-- also owns this table) and therefore bypasses BOTH the missing table grant
-- and RLS — so the function can upsert freely while a direct query from an
-- `authenticated` (or `anon`) client is blocked twice over (no grant + RLS on
-- with zero policies). The app never reads these rows directly; add an owner
-- SELECT policy (`using (auth.uid() = user_id)`) only if a direct read is ever
-- needed. service_role is revoked too (nothing on the admin path touches this
-- table); a future cleanup cron would run as the table owner / postgres.

-- ---------------------------------------------------------------------------
-- check_rate_limit(p_bucket, p_limit, p_window_seconds) -> boolean
--
-- Atomic increment-and-check for the current fixed window. Resolves the caller
-- server-side via auth.uid() — it NEVER accepts a user_id argument, so a signed
-- in user cannot spend (or reset) another user's quota by calling the RPC
-- directly (CLAUDE.md §Security 2). Returns true if the request is allowed
-- (post-increment count <= p_limit), false once the window is exhausted.
--
-- security definer + `set search_path = ''`: runs as the owner so it can write
-- the table the caller has no direct grant on; every reference is
-- schema-qualified (auth.uid, public.rate_limits) because search_path is empty.
-- Built-ins (now, floor, extract, to_timestamp) resolve from pg_catalog, which
-- is always implicitly searched.
--
-- Atomicity: the `insert ... on conflict do update ... returning count` is a
-- single statement. Concurrent requests for the same (user, bucket, window)
-- serialize on the conflicting row's lock — the update side reads the freshly
-- committed value and increments it, so no two concurrent requests can observe
-- the same count. This is what makes the limiter correct across the many
-- Vercel instances that may handle one user's burst simultaneously.
-- ---------------------------------------------------------------------------

create or replace function public.check_rate_limit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_window_start timestamptz;
  v_count int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    -- No authenticated caller. The app's routes resolve getUser() before ever
    -- calling this, so this only fires if the JWT wasn't forwarded — raise
    -- rather than attribute usage to a NULL owner. The caller (enforceRateLimit)
    -- treats any RPC error as fail-open, so an already-authenticated real user
    -- is never hard-blocked by a limiter/plumbing fault.
    raise exception 'check_rate_limit: no authenticated user (auth.uid() is null)';
  end if;

  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'check_rate_limit: p_window_seconds must be > 0 (got %)', p_window_seconds;
  end if;

  -- Floor now() to the start of the current fixed window.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as rl (user_id, bucket, window_start, count)
  values (v_user_id, p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
  do update set count = rl.count + 1
  returning rl.count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Explicit revoke-then-grant, no reliance on the implicit PUBLIC EXECUTE grant
-- that `create function` leaves behind, and undo Supabase's default-privilege
-- EXECUTE grant to `anon` (same reasoning as match_chunks): only signed-in
-- users hit the rate-limited endpoints.
revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to authenticated;
