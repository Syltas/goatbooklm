import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import type { Database } from "@/lib/database.types"

/**
 * Thin wrappers around the `enqueue_ingestion_job`/`read_ingestion_jobs`/
 * `delete_ingestion_job` Postgres functions (migration
 * `20260719150855_expose_pgmq_rpc.sql`) — the only way supabase-js can reach
 * the `pgmq` extension's `ingestion_jobs` queue, since `pgmq` itself is not
 * one of the exposed API schemas (supabase/config.toml `[api] schemas`).
 *
 * Every function here takes the Supabase client as a parameter rather than
 * importing one (service-builder DI convention). `enqueueIngestionJob` is
 * now `service_role`-only (Eng-Review C1) — callers must pass an admin
 * client, never the request-scoped user client (see
 * `lib/ingestion/deps.ts`'s `enqueueClient`). `readIngestionJobs`/
 * `deleteIngestionJob` are `service_role`-only too, worker-only — see the
 * migration's grant comments.
 */

const sourceIdSchema = z.uuid()

export interface IngestionJob {
  msgId: number
  readCt: number
  enqueuedAt: string
  vt: string
  sourceId: string
}

/**
 * A dequeued message whose payload has no (or a malformed) `source_id` —
 * "poison message" (Eng-Review H2). Never thrown for by `readIngestionJobs`
 * anymore: a single bad message used to throw and abort the ENTIRE tick,
 * starving every other queued job behind it. Callers (`processIngestionTick`
 * in `lib/ingestion/worker.ts`) must delete these immediately — there is no
 * `sourceId` to retry against, redelivery would just loop forever.
 */
export interface PoisonIngestionJob {
  msgId: number
  invalid: true
}

export type IngestionQueueEntry = IngestionJob | PoisonIngestionJob

export function isPoisonIngestionJob(
  entry: IngestionQueueEntry
): entry is PoisonIngestionJob {
  return "invalid" in entry && entry.invalid === true
}

export async function enqueueIngestionJob(
  supabase: SupabaseClient<Database>,
  sourceId: string
): Promise<void> {
  const { error } = await supabase.rpc("enqueue_ingestion_job", {
    payload: { source_id: sourceId },
  })
  if (error) throw error
}

/**
 * Reads the next batch of jobs off the queue. A message with no/an invalid
 * `source_id` in its payload is mapped to a `PoisonIngestionJob` rather than
 * thrown (Eng-Review H2) — a malformed payload must not kill the whole tick,
 * see `processIngestionTick`. This function itself can still reject/throw
 * for a genuine RPC/connection failure; callers (the worker Route Handler)
 * must handle that separately.
 */
export async function readIngestionJobs(
  supabase: SupabaseClient<Database>,
  opts: { vt?: number; qty?: number } = {}
): Promise<IngestionQueueEntry[]> {
  const { data, error } = await supabase.rpc("read_ingestion_jobs", {
    p_vt: opts.vt ?? 600,
    p_qty: opts.qty ?? 3,
  })
  if (error) throw error

  return (data ?? []).map((row): IngestionQueueEntry => {
    const message = row.message as { source_id?: unknown } | null
    const parsed = sourceIdSchema.safeParse(message?.source_id)

    if (!parsed.success) {
      console.error(
        `[ingestion-queue] job ${row.msg_id} has no/an invalid source_id in its payload — treating as poison message`,
        message
      )
      return { msgId: row.msg_id, invalid: true }
    }

    return {
      msgId: row.msg_id,
      readCt: row.read_ct,
      enqueuedAt: row.enqueued_at,
      vt: row.vt,
      sourceId: parsed.data,
    }
  })
}

export async function deleteIngestionJob(
  supabase: SupabaseClient<Database>,
  msgId: number
): Promise<void> {
  const { error } = await supabase.rpc("delete_ingestion_job", {
    msg_id: msgId,
  })
  if (error) throw error
}
