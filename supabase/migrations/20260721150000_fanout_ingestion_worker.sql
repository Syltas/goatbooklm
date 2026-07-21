-- ---------------------------------------------------------------------------
-- Ingestion-worker fan-out: 3 parallel POSTs per tick instead of 1.
--
-- Throughput before this migration: 1 source per 15s tick (4/min) — a bulk
-- upload of 10 sources took ~2.5 minutes minimum. Parallelization happens at
-- the INVOCATION level, deliberately NOT by raising the route's
-- READ_BATCH_SIZE above 1:
--
--  - Each POST is its own serverless invocation reading exactly ONE message
--    (`app/api/ingestion-worker/route.ts`'s `READ_BATCH_SIZE = 1`), so
--    pgmq's read_ct stays a reliable per-job attempt count and the read_ct
--    dead-letter backstop (`lib/ingestion/worker.ts`'s
--    `MAX_DELIVERY_ATTEMPTS`) keeps working — an in-process batch (qty > 1)
--    would let one crashing job inflate read_ct for healthy batch-mates and
--    eventually dead-letter untouched sources. See the long comment above
--    `READ_BATCH_SIZE` in the route.
--  - Crash isolation is total: an OOM/timeout kill in one invocation cannot
--    touch the jobs the other two invocations hold.
--  - No double-delivery: pgmq's read() is atomic (SKIP LOCKED under the
--    hood) — three concurrent readers get three different messages (or
--    empty results once the queue is drained; an empty read is a no-op
--    invocation, cheap).
--
-- The concurrent-regeneration side effect this enables (several sources of
-- the SAME notebook finishing in parallel invocations) is handled by
-- `NotebookSummaryService.regenerateWhenSettled` (summary debounce) — see
-- `lib/notebooks/summary-service.ts`.
--
-- `cron.schedule` with an existing job name REPLACES that job's schedule +
-- command (pg_cron named-job upsert semantics, verified on pg_cron 1.6.4) —
-- no `cron.unschedule` needed, and re-running this migration is idempotent.
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
  from public.ingestion_worker_config c
  cross join generate_series(1, 3);
  $$
);
