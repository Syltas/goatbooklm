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

export interface WorkerTickDeps {
  runIngestionJob: (data: { sourceId: string }) => Promise<Source>
  deleteJob: (msgId: number) => Promise<void>
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
   */
  status: "ready" | "error" | "crashed" | "notFound" | "invalid"
  errorMessage?: string
  /**
   * The source's notebook — only known when `runIngestionJob` actually
   * resolved a source row (i.e. `status` is `"ready"` or `"error"`, never
   * `"crashed"`/`"notFound"`/`"invalid"`). The route handler uses this to
   * trigger a notebook-summary regeneration (Part A of the empty-chat-
   * summary feature) right after a `ready` result, without a second DB
   * lookup for the source's `notebook_id`.
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
