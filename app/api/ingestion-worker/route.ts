import { timingSafeEqual } from "node:crypto"

import { anthropic } from "@ai-sdk/anthropic"
import type { SupabaseClient } from "@supabase/supabase-js"
import { generateText } from "ai"
import { NextResponse } from "next/server"

import type { Database } from "@/lib/database.types"
import { createIngestionDeps } from "@/lib/ingestion/deps"
import { deleteIngestionJob, readIngestionJobs } from "@/lib/ingestion/queue"
import { createIngestionService } from "@/lib/ingestion/service"
import { processIngestionTick } from "@/lib/ingestion/worker"
import { createNotebookSummaryService, type SummarizeFn } from "@/lib/notebooks/summary-service"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * pg_cron-triggered ingestion worker (specs/02-ingestion.md §9
 * Worker-Contract, §4 Punkt 1). Never called by a user — `pg_cron` +
 * `pg_net` POST here every 15s (see
 * `supabase/migrations/20260719144042_create_ingestion_queue.sql`'s
 * `cron.schedule(...)`, which reads the target URL + shared secret from
 * `public.ingestion_worker_config`). Auth is a single shared-secret header
 * check (`x-worker-secret` — NOT the DB row's own RLS, there is no acting
 * user here), fail-closed, constant-time compared.
 *
 * `maxDuration = 300`: this is the ONLY route in the app that needs a long
 * timeout — Add-Source Server Actions are enqueue-only (milliseconds), the
 * heavy extract→chunk→embed→persist pipeline runs exclusively here.
 */
export const maxDuration = 300
export const runtime = "nodejs"

const WORKER_SECRET_HEADER = "x-worker-secret"
const READ_VT_SECONDS = 600
const READ_BATCH_SIZE = 3

// Same slug as `app/api/chat/route.ts`'s `CHAT_MODEL_ID` — verified against
// the installed `@ai-sdk/anthropic`'s `AnthropicModelId` union, a real,
// currently-deployable slug. Not imported from the chat route: that module
// is request/streaming-specific (§3.4 chat contract) and this worker calls
// the model very differently (`generateText`, no streaming, no chat
// history) — a shared constant here would be the only thing coupling the
// two.
const SUMMARY_MODEL_ID = "claude-sonnet-5"

/**
 * Real `SummarizeFn` wiring for `lib/notebooks/summary-service.ts` — a plain
 * non-streaming `generateText` call (there is no client waiting on a stream
 * here, unlike `app/api/chat/route.ts`'s `streamText`). Composed at this
 * route rather than imported into the service module itself, same
 * "injected dependency, not a direct provider import" rule as
 * `ChatServiceDeps.embed`/`IngestionDeps.embedChunks` — keeps
 * `summary-service.ts` unit-testable with a stub, no real Anthropic call.
 */
const summarizeWithClaude: SummarizeFn = async ({ system, prompt, maxOutputTokens }) => {
  const { text } = await generateText({
    model: anthropic(SUMMARY_MODEL_ID),
    system,
    prompt,
    temperature: 0.2,
    maxOutputTokens,
  })
  return text
}

// Eng-Review L3: the expected secret is no longer read from
// `process.env.INGESTION_WORKER_SECRET` — it lives ONLY in the
// `ingestion_worker_config` table now (seeded via a `gen_random_uuid()`, not
// a literal, in supabase/seed.sql; set via a manual SQL UPDATE in prod), so
// no secret value has to be committed to the repo in any form, env-file or
// migration. A short module-level TTL cache avoids a DB round trip on every
// 15s tick while still picking up a rotated secret (e.g. the prod UPDATE
// statement) within a few seconds, without needing a redeploy.
const SECRET_CACHE_TTL_MS = 30_000
let cachedSecret: { value: string; fetchedAt: number } | null = null

async function loadWorkerSecret(
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  if (cachedSecret && Date.now() - cachedSecret.fetchedAt < SECRET_CACHE_TTL_MS) {
    return cachedSecret.value
  }

  const { data, error } = await supabase
    .from("ingestion_worker_config")
    .select("secret")
    .eq("id", true)
    .maybeSingle()

  if (error) {
    console.error(
      "[ingestion-worker] failed to load the worker secret from ingestion_worker_config:",
      error
    )
    return null
  }

  // Fail-closed: a missing config row (nothing seeded/configured yet) means
  // there is no valid secret — reject every request rather than falling
  // back to some default.
  if (!data?.secret) return null

  cachedSecret = { value: data.secret, fetchedAt: Date.now() }
  return cachedSecret.value
}

function isValidWorkerSecret(
  expected: string | null,
  headerValue: string | null
): boolean {
  // Fail-closed: no configured secret, no header, or a length mismatch (which
  // `timingSafeEqual` requires equal-length buffers for anyway) all reject.
  if (!expected || !headerValue) return false

  const expectedBuf = Buffer.from(expected)
  const headerBuf = Buffer.from(headerValue)
  if (expectedBuf.length !== headerBuf.length) return false

  return timingSafeEqual(expectedBuf, headerBuf)
}

export async function POST(request: Request) {
  const supabase = createAdminClient()
  const expectedSecret = await loadWorkerSecret(supabase)

  if (!isValidWorkerSecret(expectedSecret, request.headers.get(WORKER_SECRET_HEADER))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = createIngestionService(createIngestionDeps(supabase))

  // Eng-Review H2: `readIngestionJobs` no longer throws for an individual
  // poison message (see `lib/ingestion/queue.ts` — those come back as
  // `{ msgId, invalid: true }` entries for `processIngestionTick` to delete
  // below), but it can still reject for a genuine RPC/connection failure.
  // That must produce a defined 500 response rather than an unhandled
  // rejection crashing the whole route.
  let jobs
  try {
    jobs = await readIngestionJobs(supabase, {
      vt: READ_VT_SECONDS,
      qty: READ_BATCH_SIZE,
    })
  } catch (error) {
    console.error("[ingestion-worker] failed to read jobs from the queue:", error)
    return NextResponse.json(
      { error: "Failed to read the ingestion queue." },
      { status: 500 }
    )
  }

  // `jobs` (IngestionQueueEntry[]) is structurally assignable to
  // `WorkerQueueItem[]` — both the valid-job and poison-job shapes match —
  // no remapping needed; `processIngestionTick` deletes poison entries
  // itself instead of ever calling `runIngestionJob` for them.
  const results = await processIngestionTick(jobs, {
    runIngestionJob: (data) => service.runIngestionJob(data),
    deleteJob: (msgId) => deleteIngestionJob(supabase, msgId),
  })

  // Part A (empty-chat summary) — regenerate right after the `ready`
  // TRANSITION, never at insert time: `results` only carries `notebookId`
  // for jobs where `runIngestionJob` actually resolved a source row (see
  // `WorkerJobResult`'s doc comment), so `notFound`/`crashed`/`invalid`
  // entries are naturally excluded. Deduped via `Set` — a bulk upload can
  // land several sources of the SAME notebook in one tick, and each only
  // needs one regeneration covering all of them, not one per source.
  const readyNotebookIds = new Set(
    results
      .filter((result) => result.status === "ready" && result.notebookId)
      .map((result) => result.notebookId as string)
  )
  const summaryService = createNotebookSummaryService({
    db: supabase,
    summarize: summarizeWithClaude,
  })
  for (const notebookId of readyNotebookIds) {
    // `regenerate` never throws (see its own doc comment) — no try/catch
    // needed here, but a summary failure must never have been able to
    // reach this loop as an unhandled rejection either way.
    await summaryService.regenerate(notebookId)
  }

  return NextResponse.json({ processed: jobs.length, results })
}
