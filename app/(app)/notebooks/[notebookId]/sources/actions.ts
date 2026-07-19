"use server"

import { revalidatePath } from "next/cache"

import { createIngestionDeps } from "@/lib/ingestion/deps"
import {
  AddTextSourceSchema,
  AddWebSourceSchema,
  CreatePdfSourceSchema,
  DeleteSourceSchema,
  ProcessSourceSchema,
  RetrySourceSchema,
} from "@/lib/ingestion/schema"
import { createIngestionService, type Source } from "@/lib/ingestion/service"
import { INGESTION_MESSAGES } from "@/lib/ingestion/messages"
import { enhanceAction, type ActionResult } from "@/lib/server/action"
import { toGermanErrorMessage } from "@/lib/server/error-messages"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

// No `maxDuration` export in this file (F2, specs/02-ingestion.md §9):
// `'use server'` files may only export async functions, and it isn't
// needed anyway — every action below is enqueue-only (a row insert/update +
// one `enqueue_ingestion_job` RPC call), never the extract→chunk→embed
// pipeline itself. That runs exclusively in
// `app/api/ingestion-worker/route.ts`, which carries `maxDuration = 300`.

const KNOWN_INGESTION_MESSAGES = new Set<string>(
  Object.values(INGESTION_MESSAGES)
)

/**
 * `IngestionService` methods throw plain `Error`s whose `.message` is
 * already one of the fixed, German, user-facing Fehler-Matrix strings
 * (specs/02-ingestion.md §10) — those are returned verbatim. Anything else
 * (a raw Supabase/PostgREST error, an unexpected exception) goes through
 * `toGermanErrorMessage`, which logs the original and maps it to a generic
 * German fallback instead of leaking an English/implementation-detail
 * string to the client.
 */
function getErrorMessage(error: unknown, context: string): string {
  if (error instanceof Error && KNOWN_INGESTION_MESSAGES.has(error.message)) {
    console.error(`[${context}]`, error)
    return error.message
  }
  return toGermanErrorMessage(error, context)
}

const NOTEBOOK_DETAIL_PATH = "/notebooks/[notebookId]"

export const createPdfSourceAction = enhanceAction(
  async (
    data,
    user
  ): Promise<ActionResult<{ sourceId: string; storagePath: string }>> => {
    const client = await createClient()
    const service = createIngestionService(createIngestionDeps(client))

    try {
      const result = await service.createPendingPdfSource({
        notebookId: data.notebookId,
        userId: user.id,
        title: data.title,
        fileName: data.fileName,
      })
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: result }
    } catch (error) {
      return { error: getErrorMessage(error, "create-pdf-source-action") }
    }
  },
  { auth: true, schema: CreatePdfSourceSchema }
)

/**
 * Called by the client once it has finished uploading the file directly to
 * Storage (AC-10) — enqueues the processing job and returns immediately;
 * the pipeline itself runs only in the worker's next tick.
 */
export const processSourceAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ enqueued: true }>> => {
    const client = await createClient()
    // enqueue_ingestion_job is service_role-only (Eng-Review C1) — the
    // service's own getOwnedSource check below still runs against `client`
    // (RLS-scoped), the admin client is used ONLY for the enqueue RPC call
    // that follows it. See lib/ingestion/deps.ts's `enqueueClient` doc.
    const service = createIngestionService(
      createIngestionDeps(client, { enqueueClient: createAdminClient() })
    )

    try {
      await service.enqueueIngestionJob({
        sourceId: data.sourceId,
        userId: user.id,
      })
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: { enqueued: true } }
    } catch (error) {
      return { error: getErrorMessage(error, "process-source-action") }
    }
  },
  { auth: true, schema: ProcessSourceSchema }
)

export const addTextSourceAction = enhanceAction(
  async (data, user): Promise<ActionResult<Source>> => {
    const client = await createClient()
    // See processSourceAction above — the row insert itself is still
    // RLS-scoped (`client`), only the enqueue RPC needs service_role.
    const service = createIngestionService(
      createIngestionDeps(client, { enqueueClient: createAdminClient() })
    )

    try {
      const source = await service.createTextSource({
        notebookId: data.notebookId,
        userId: user.id,
        title: data.title,
        text: data.text,
      })
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: source }
    } catch (error) {
      return { error: getErrorMessage(error, "add-text-source-action") }
    }
  },
  { auth: true, schema: AddTextSourceSchema }
)

export const addWebSourceAction = enhanceAction(
  async (data, user): Promise<ActionResult<Source>> => {
    const client = await createClient()
    // See processSourceAction above — the row insert itself is still
    // RLS-scoped (`client`), only the enqueue RPC needs service_role.
    const service = createIngestionService(
      createIngestionDeps(client, { enqueueClient: createAdminClient() })
    )

    try {
      // assertSafeUrl runs first, inside createWebSource, as a synchronous
      // pre-check before any row is created (AC-14/AC-15) — the service
      // itself enforces "no row on a rejected pre-check", nothing extra to
      // do here.
      const source = await service.createWebSource({
        notebookId: data.notebookId,
        userId: user.id,
        url: data.url,
        title: data.title,
      })
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: source }
    } catch (error) {
      return { error: getErrorMessage(error, "add-web-source-action") }
    }
  },
  { auth: true, schema: AddWebSourceSchema }
)

export const retrySourceAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ enqueued: true }>> => {
    const client = await createClient()
    // See processSourceAction above — retrySource's own getOwnedSource
    // check still runs against `client` (RLS-scoped), only the enqueue RPC
    // needs service_role.
    const service = createIngestionService(
      createIngestionDeps(client, { enqueueClient: createAdminClient() })
    )

    try {
      await service.retrySource({ sourceId: data.sourceId, userId: user.id })
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: { enqueued: true } }
    } catch (error) {
      return { error: getErrorMessage(error, "retry-source-action") }
    }
  },
  { auth: true, schema: RetrySourceSchema }
)

export const deleteSourceAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ success: true }>> => {
    const client = await createClient()
    const service = createIngestionService(createIngestionDeps(client))

    try {
      await service.deleteSource({ sourceId: data.sourceId, userId: user.id })
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: { success: true } }
    } catch (error) {
      return { error: getErrorMessage(error, "delete-source-action") }
    }
  },
  { auth: true, schema: DeleteSourceSchema }
)
