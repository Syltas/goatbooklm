import { SourceNotFoundError, type Source } from "./service"

/**
 * Pure orchestration logic for one pg_cron-triggered worker tick
 * (specs/02-ingestion.md §9 Worker-Contract, §7 pipeline diagram). Factored
 * out of `app/api/ingestion-worker/route.ts` so it's unit-testable without
 * mocking `NextResponse`/real Supabase clients — the route handler itself
 * stays a thin adapter (resolve deps, call this, respond).
 */

export interface WorkerJob {
  msgId: number
  sourceId: string
  /**
   * pgmq's per-message delivery counter (`IngestionJob.readCt` in
   * `lib/ingestion/queue.ts`) — checked against `MAX_DELIVERY_ATTEMPTS`
   * below BEFORE `runIngestionJob` is ever called again for this job. A job
   * that keeps crashing the process itself (OOM, a `maxDuration` timeout
   * kill) never reaches `runIngestionJob`'s own catch block, so without this
   * check it would be redelivered by pgmq forever, delaying every other job
   * queued behind it in the same batch.
   */
  readCt: number
}

/**
 * A dequeued message whose payload had no/an invalid `source_id` — see
 * `lib/ingestion/queue.ts`'s `PoisonIngestionJob` (Eng-Review H2). Shaped
 * identically to that type so `readIngestionJobs`'s result can be passed
 * into `processIngestionTick` unchanged; defined locally (not imported) to
 * keep this module's only dependency a pure `Source`/error type from
 * `./service`, matching its "unit-testable without mocking real Supabase
 * clients" design goal.
 */
export interface PoisonWorkerJob {
  msgId: number
  invalid: true
}

export type WorkerQueueItem = WorkerJob | PoisonWorkerJob

function isPoisonWorkerJob(job: WorkerQueueItem): job is PoisonWorkerJob {
  return "invalid" in job && job.invalid === true
}

/**
 * Max times pgmq may redeliver a job (its read_ct) before the worker gives
 * up and dead-letters it instead of leaving it for yet another redelivery.
 * The normal `runIngestionJob`-throws case already gets its own retries up
 * to this point — only a delivery ABOVE it is dead-lettered, so a genuinely
 * transient failure (DB blip, provider hiccup) is unaffected. Five is
 * generous for that case while still bounding the worst case (an
 * uncatchable crash — OOM, a `maxDuration` timeout kill — that never reaches
 * `runIngestionJob`'s own catch block) to a handful of wasted ticks instead
 * of forever.
 *
 * Correctness of this check depends on `app/api/ingestion-worker/route.ts`
 * reading (`READ_BATCH_SIZE`) exactly ONE message per tick. pgmq's read_ct
 * increments for every message a batch read returns, including ones the
 * consumer never got to attempt — with a batch size > 1, a crash on job A
 * would inflate read_ct (and eventually dead-letter) untouched, healthy
 * jobs B/C read in the same batch. Do not raise `READ_BATCH_SIZE` above 1
 * without re-deriving this threshold against a per-job (not per-batch-read)
 * attempt signal.
 */
export const MAX_DELIVERY_ATTEMPTS = 5

const DEAD_LETTER_MESSAGE = "Verarbeitung nach mehreren Versuchen abgebrochen."

export interface WorkerTickDeps {
  runIngestionJob: (data: { sourceId: string }) => Promise<Source>
  deleteJob: (msgId: number) => Promise<void>
  /**
   * Marks a source row terminally failed WITHOUT running the pipeline again
   * — used only by the read_ct dead-letter path in `processIngestionTick`,
   * where `sourceId` has already crashed (or killed the whole worker
   * process) `MAX_DELIVERY_ATTEMPTS` times, so calling `runIngestionJob` once
   * more would just repeat whatever is crashing it. Persists the same
   * `sources.status = 'error'` + `error_message` shape `runIngestionJob`'s
   * own catch block persists for a handled failure (`lib/ingestion/service.ts`)
   * — wired directly against the `sources` table by the route handler, since
   * this module deliberately has no direct DB access of its own (see the
   * module doc comment above).
   *
   * Returns the failed source's `notebook_id` (or `null` if the row no
   * longer exists) so the dead-letter result can carry a `notebookId` like
   * the handled `ready`/`error` outcomes do — the route's summary debounce
   * (`regenerateWhenSettled`) needs every terminal outcome, dead-letter
   * included, as a potential "notebook just settled, regenerate now"
   * trigger; without it, a notebook whose LAST in-flight source dead-letters
   * would keep a previously skipped ready-transition stale forever.
   */
  markSourceFailed: (sourceId: string, message: string) => Promise<string | null>
}

export interface WorkerJobResult {
  msgId: number
  sourceId: string
  /**
   * `"crashed"` = `runIngestionJob` itself threw an unhandled, *retryable*
   * error — the job is deliberately left in the queue for pgmq's
   * visibility-timeout redelivery, see the doc comment on
   * `processIngestionTick` below.
   *
   * `"notFound"` (Eng-Review M1) = `runIngestionJob` threw
   * `SourceNotFoundError` — the source row is gone (e.g. deleted while the
   * job was queued). This is terminal, not retryable: redelivery would hit
   * the exact same "not found" error forever, since there is no row left to
   * process. The job is deleted immediately, same as a handled
   * `'ready'`/`'error'` outcome.
   *
   * `"invalid"` (Eng-Review H2) = the dequeued message itself was a poison
   * message (no/an invalid `source_id` in its payload, see
   * `lib/ingestion/queue.ts`) — `runIngestionJob` is never even called for
   * these. Also terminal/deleted immediately: there is no `sourceId` to
   * retry against.
   *
   * `"deadLettered"` (read_ct dead-letter backstop) = the job's pgmq
   * redelivery count exceeded `MAX_DELIVERY_ATTEMPTS` — `runIngestionJob`
   * was never called for it this tick; the source was marked `error`
   * directly and the job was deleted, same as a handled terminal outcome.
   */
  status: "ready" | "error" | "crashed" | "notFound" | "invalid" | "deadLettered"
  errorMessage?: string
  /**
   * The source's notebook — known when `runIngestionJob` actually resolved a
   * source row (`status` `"ready"`/`"error"`) or when the dead-letter path's
   * `markSourceFailed` update found the row (`"deadLettered"`, unless the
   * row vanished meanwhile); never for `"crashed"`/`"notFound"`/`"invalid"`.
   * The route handler feeds every result carrying a `notebookId` into the
   * summary debounce (`regenerateWhenSettled`, Part A of the empty-chat-
   * summary feature) — terminal non-ready outcomes matter there too, as the
   * "notebook settled, catch up on a previously skipped regeneration"
   * trigger — without a second DB lookup for the source's `notebook_id`.
   */
  notebookId?: string
}

/**
 * Deletes a job that reached a handled terminal state (ready/error/notFound/
 * invalid). Never throws: a delete failure is logged and swallowed rather
 * than failing the whole tick — worst case the message is redelivered once
 * more and reprocessed idempotently (or, for notFound/invalid, hits the same
 * terminal outcome again and gets deleted on the next tick instead).
 */
async function deleteTerminalJob(
  deps: WorkerTickDeps,
  msgId: number,
  reason: string
): Promise<void> {
  try {
    await deps.deleteJob(msgId)
  } catch (error) {
    console.error(
      `[ingestion-worker] failed to delete ${reason} job ${msgId}:`,
      error
    )
  }
}

/**
 * Best-effort counterpart to `deleteTerminalJob` for the read_ct dead-letter
 * path — a failure marking the source row must not block the delete that
 * actually stops the redelivery loop (the primary goal here), so it is only
 * logged, never re-thrown. Returns the source's `notebook_id` when the mark
 * succeeded and found the row, `null` otherwise (row gone, or the marking
 * itself failed — in the latter case there is nothing settled to summarize
 * anyway, the source row still LOOKS in-flight/stale to the debounce).
 */
async function markSourceFailedBestEffort(
  deps: WorkerTickDeps,
  sourceId: string,
  message: string
): Promise<string | null> {
  try {
    return await deps.markSourceFailed(sourceId, message)
  } catch (error) {
    console.error(
      `[ingestion-worker] failed to mark source ${sourceId} as failed during dead-letter:`,
      error
    )
    return null
  }
}

/**
 * Processes one tick's worth of jobs sequentially, isolating each job's
 * failure from the rest of the batch (a crash on job N must not prevent
 * jobs N+1..end from running — a single broken source must not kill the
 * whole tick).
 *
 * `runIngestionJob` itself already catches every *handled* pipeline failure
 * internally and resolves with `status: 'error'` (never throws for those) —
 * see `IngestionService.runIngestionJob`'s try/catch. It only throws for
 * genuinely unhandled cases: a `SourceNotFoundError` (terminal — see
 * `WorkerJobResult`'s doc comment) or a DB write failing even inside the
 * catch block's own error-status update (retryable — left for redelivery).
 * A job whose call *resolves* (status `'ready'` OR `'error'` — both are a
 * handled terminal outcome), throws `SourceNotFoundError`, or was already a
 * poison message before `runIngestionJob` was ever called, is deleted from
 * the queue. A job whose call throws anything else is left in place — no
 * `deleteJob` call — so pgmq's visibility timeout redelivers it on a later
 * tick (specs/02-ingestion.md §4 Punkt 1 "Crash-Resilienz").
 */
export async function processIngestionTick(
  jobs: WorkerQueueItem[],
  deps: WorkerTickDeps
): Promise<WorkerJobResult[]> {
  const results: WorkerJobResult[] = []

  for (const job of jobs) {
    if (isPoisonWorkerJob(job)) {
      console.error(
        `[ingestion-worker] job ${job.msgId} is a poison message (no/invalid source_id) — deleting, not retrying`
      )
      await deleteTerminalJob(deps, job.msgId, "poison")
      results.push({ msgId: job.msgId, sourceId: "", status: "invalid" })
      continue
    }

    if (job.readCt > MAX_DELIVERY_ATTEMPTS) {
      console.error(
        `[ingestion-worker] job ${job.msgId} (source ${job.sourceId}) exceeded ${MAX_DELIVERY_ATTEMPTS} delivery attempts (read_ct=${job.readCt}) — dead-lettering instead of leaving it for further redelivery`
      )
      const notebookId = await markSourceFailedBestEffort(
        deps,
        job.sourceId,
        DEAD_LETTER_MESSAGE
      )
      await deleteTerminalJob(deps, job.msgId, "dead-lettered")
      results.push({
        msgId: job.msgId,
        sourceId: job.sourceId,
        status: "deadLettered",
        errorMessage: DEAD_LETTER_MESSAGE,
        ...(notebookId ? { notebookId } : {}),
      })
      continue
    }

    let source: Source
    try {
      source = await deps.runIngestionJob({ sourceId: job.sourceId })
    } catch (error) {
      if (error instanceof SourceNotFoundError) {
        console.error(
          `[ingestion-worker] job ${job.msgId} (source ${job.sourceId}) — source not found, deleting, not retrying:`,
          error
        )
        await deleteTerminalJob(deps, job.msgId, "not-found")
        results.push({
          msgId: job.msgId,
          sourceId: job.sourceId,
          status: "notFound",
          errorMessage: error.message,
        })
        continue
      }

      console.error(
        `[ingestion-worker] job ${job.msgId} (source ${job.sourceId}) crashed — left in queue for redelivery:`,
        error
      )
      results.push({
        msgId: job.msgId,
        sourceId: job.sourceId,
        status: "crashed",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    await deleteTerminalJob(deps, job.msgId, "completed")

    results.push({
      msgId: job.msgId,
      sourceId: source.id,
      status: source.status === "ready" ? "ready" : "error",
      errorMessage: source.error_message ?? undefined,
      notebookId: source.notebook_id,
    })
  }

  return results
}
