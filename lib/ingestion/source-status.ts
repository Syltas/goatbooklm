import { INGESTION_MESSAGES, STALE_PROCESSING_MS } from "./messages"

/**
 * Client-side staleness guard (AC-46/OV2 fallback): a source stuck on
 * `status='processing'` with an `updated_at` older than 10 minutes is
 * rendered as `error` with a fixed message, and Retry is allowed to
 * override it (AC-41 exception) — derived purely from already-fetched data,
 * no DB write (pgmq's own visibility-timeout redelivery, §4 Punkt 1, is the
 * primary mechanism; this is only the fallback for the case where a job was
 * already dequeued but the row's status update itself failed).
 *
 * Eng-Review M2: the same guard applies to `status='pending'` — a source
 * whose enqueue/pickup never happened (or got lost) is otherwise stuck
 * forever, since nothing else would ever move it out of `pending`. Same
 * 10-minute threshold, its own fixed message (`stalePending`, distinct from
 * `staleTimeout` — the retry story differs, see `service.ts`'s
 * `retrySource`), same "render as `error`, stop polling, allow Retry"
 * treatment.
 *
 * Pure + zero-dependency (only imports the string/threshold constants) so
 * it runs identically in a Server Component's initial render and a Client
 * Component's polling loop — one implementation, no drift between the two.
 */

export type SourceStatus = "pending" | "processing" | "ready" | "error"

export interface StatusLike {
  // The generated `Database["public"]["Tables"]["sources"]["Row"]["status"]`
  // type is plain `string` — Supabase's codegen only narrows a column to a
  // literal union for a real Postgres `enum` type, not a `check (status in
  // (...))` constraint (which is what `sources.status` uses) — so this
  // accepts `string` and narrows internally via the `===` comparisons
  // below, rather than requiring every caller to cast a `Source` row first.
  status: string
  updated_at: string
  error_message: string | null
}

function isOlderThanStaleThreshold(updatedAt: string): boolean {
  return Date.now() - new Date(updatedAt).getTime() > STALE_PROCESSING_MS
}

export function isStaleProcessing(source: StatusLike): boolean {
  return source.status === "processing" && isOlderThanStaleThreshold(source.updated_at)
}

/** A `pending` source that has sat unpicked-up for longer than the stale
 *  threshold (Eng-Review M2) — see module doc comment. */
export function isStalePending(source: StatusLike): boolean {
  return source.status === "pending" && isOlderThanStaleThreshold(source.updated_at)
}

/** Either flavor of staleness — the two are mutually exclusive (different
 *  underlying `status`), kept as separate predicates above because their
 *  respective error messages/retry semantics differ. */
export function isStale(source: StatusLike): boolean {
  return isStaleProcessing(source) || isStalePending(source)
}

/** The status to actually render — `error` for a stale `processing` OR
 *  stale `pending` row, the raw DB status otherwise. */
export function effectiveStatus(source: StatusLike): SourceStatus {
  return isStale(source) ? "error" : (source.status as SourceStatus)
}

/** The error message to actually render, applying the same stale override. */
export function effectiveErrorMessage(source: StatusLike): string | null {
  if (isStalePending(source)) return INGESTION_MESSAGES.stalePending
  if (isStaleProcessing(source)) return INGESTION_MESSAGES.staleTimeout
  return source.error_message
}

/** Whether the panel's 2s poll loop needs to keep running for this source
 *  (AC-31) — a *stale* `processing` OR `pending` row counts as already-final
 *  (it's rendered as `error`), so it must NOT keep the poll alive forever. */
export function isNonFinal(source: StatusLike): boolean {
  const status = effectiveStatus(source)
  return status === "pending" || status === "processing"
}
