-- Exposes the `ingestion_jobs` pgmq queue to supabase-js via three
-- security-definer wrapper functions in `public` (Spec 02 — Source-Ingestion,
-- §9 Worker-Contract). `pgmq` itself lives outside the exposed API schemas
-- (supabase/config.toml [api] schemas = ["public","graphql_public"]), so
-- `pgmq.send`/`pgmq.read`/`pgmq.delete` are unreachable from supabase-js
-- (no raw-SQL driver in this project — see @supabase/supabase-js only)
-- without a `public`-schema RPC in front of them.
--
-- Ownership/privilege note: each function is `security definer` + `set
-- search_path = ''` (every reference inside is schema-qualified) and owned
-- by the migration-running role, which already has USAGE on `pgmq` from the
-- previous migration's `pgmq.create('ingestion_jobs')` call — that's what
-- lets `authenticated`/`service_role` callers reach `pgmq` at all despite
-- having zero direct grants on the `pgmq` schema itself.

-- ---------------------------------------------------------------------------
-- enqueue_ingestion_job(payload jsonb) -> msg_id bigint
--
-- service_role ONLY (Eng-Review C1, 2026-07-19). Earlier revision also
-- granted this to `authenticated` on the theory that "the payload is only
-- ever `{ source_id }` and every Server-Action call site enqueues after an
-- ownership check" — but that ownership check happens in the *service
-- layer*, not in this function, so a signed-in user calling this RPC
-- directly (any Postgres client, not just this app's Server Actions) could
-- enqueue an arbitrary payload for ANY source_id, including ones they don't
-- own: pgmq has no row-level ownership concept, and this function runs
-- security definer against a non-RLS'd queue, so it cannot re-check
-- ownership itself. Add-Source Server Actions now enqueue via
-- `createAdminClient()` (service_role) in the action layer, strictly AFTER
-- the service layer's own RLS-scoped ownership check (`getOwnedSource` /
-- the insert's own RLS `with check`) has already passed — see
-- lib/ingestion/deps.ts's `enqueueClient` param and
-- app/(app)/notebooks/[notebookId]/sources/actions.ts. The worker's own
-- (currently unused, kept-symmetric) re-enqueue paths already run as
-- service_role too.
--
-- Defense in depth: the payload's `source_id` is validated as a well-formed
-- uuid before ever reaching `pgmq.send` — `(payload->>'source_id')::uuid`
-- raises on anything that isn't a valid uuid literal, and an explicit NULL
-- check catches a missing/absent key (casting a NULL text to uuid yields
-- NULL, not an error, so that case needs its own guard). This keeps a
-- malformed/garbage payload from ever landing in the queue, where a poison
-- message would otherwise have to be caught later by the worker (see H2 /
-- lib/ingestion/queue.ts's `readIngestionJobs`).
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_ingestion_job(payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
begin
  v_source_id := (payload->>'source_id')::uuid;
  if v_source_id is null then
    raise exception 'enqueue_ingestion_job: payload.source_id is required';
  end if;

  return pgmq.send('ingestion_jobs', payload);
end;
$$;

-- ---------------------------------------------------------------------------
-- read_ingestion_jobs(p_vt integer, p_qty integer) -> setof job rows
--
-- service_role ONLY — this drains the queue for processing, exclusively
-- called from the worker Route Handler's createAdminClient(). Never
-- callable by `authenticated`: an ordinary user reading/hiding other users'
-- queued jobs (pgmq has no row-level ownership concept) would be a data
-- leak (source ids/payloads of every user's in-flight jobs) and a griefing
-- vector (reading a job sets its visibility timeout, delaying it for
-- everyone).
--
-- Parameters are prefixed `p_` (not `vt`/`qty`) to avoid an ambiguous-name
-- collision with the `vt` OUT column below — `vt` is both a `pgmq.read`
-- parameter name and a `pgmq.message_record` column name, and this wrapper
-- needs to reference the column unambiguously in its SELECT list.
-- ---------------------------------------------------------------------------

create or replace function public.read_ingestion_jobs(p_vt integer default 600, p_qty integer default 3)
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
  from pgmq.read('ingestion_jobs', p_vt, p_qty);
$$;

-- ---------------------------------------------------------------------------
-- delete_ingestion_job(msg_id bigint) -> boolean
--
-- service_role ONLY — same reasoning as read_ingestion_jobs: only the
-- worker, having just finished (or handled-error'd) a job it legitimately
-- read, should ever remove a message from the queue.
-- ---------------------------------------------------------------------------

create or replace function public.delete_ingestion_job(msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.delete('ingestion_jobs', msg_id);
$$;

-- ---------------------------------------------------------------------------
-- Grants — explicit revoke-then-grant on every function, no reliance on the
-- implicit PUBLIC EXECUTE grant `create function` leaves in place.
-- ---------------------------------------------------------------------------

revoke all on function public.enqueue_ingestion_job(jsonb) from public, anon, authenticated;
revoke all on function public.read_ingestion_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.delete_ingestion_job(bigint) from public, anon, authenticated;

grant execute on function public.enqueue_ingestion_job(jsonb) to service_role;
grant execute on function public.read_ingestion_jobs(integer, integer) to service_role;
grant execute on function public.delete_ingestion_job(bigint) to service_role;
