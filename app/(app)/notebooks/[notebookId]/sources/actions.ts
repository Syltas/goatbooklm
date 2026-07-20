"use server"

import { revalidatePath } from "next/cache"

import { createIngestionDeps } from "@/lib/ingestion/deps"
import { detectFileFormat } from "@/lib/ingestion/formats"
import {
  AddTextSourceSchema,
  AddWebSourceSchema,
  CreateFileSourceSchema,
  DeleteSourceSchema,
  ProcessSourceSchema,
  RetrySourceSchema,
  SourceImageUrlSchema,
} from "@/lib/ingestion/schema"
import {
  createIngestionService,
  DuplicateSourceError,
  type Source,
} from "@/lib/ingestion/service"
import { INGESTION_MESSAGES } from "@/lib/ingestion/messages"
import { invalidateNotebookSummary } from "@/lib/notebooks/summary-service"
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
  // `DuplicateSourceError`'s message names the conflicting source
  // dynamically (content-hash dedupe, tasks 5/6) — it can never be a member
  // of the fixed `KNOWN_INGESTION_MESSAGES` set like every other
  // Fehler-Matrix string below, so it's let through by type instead of by
  // exact string match.
  if (error instanceof DuplicateSourceError) {
    console.error(`[${context}]`, error)
    return error.message
  }
  if (error instanceof Error && KNOWN_INGESTION_MESSAGES.has(error.message)) {
    console.error(`[${context}]`, error)
    return error.message
  }
  return toGermanErrorMessage(error, context)
}

const NOTEBOOK_DETAIL_PATH = "/notebooks/[notebookId]"

export const createFileSourceAction = enhanceAction(
  async (
    data,
    user
  ): Promise<ActionResult<{ sourceId: string; storagePath: string }>> => {
    // Resolve the format server-side rather than accepting a client-declared
    // type: the type selects the extraction head and the Storage path, so
    // trusting the client with it would let a caller point any bytes at any
    // extractor. The client runs the same `detectFileFormat` for immediate
    // feedback, but this is the check that counts — and the worker still
    // re-verifies the bytes' magic number on top of it.
    const detected = detectFileFormat(data.fileName, data.fileMimeType)
    if (!detected.ok) {
      return {
        error:
          detected.reason === "video"
            ? INGESTION_MESSAGES.videoUnsupported
            : INGESTION_MESSAGES.unsupportedFileType,
      }
    }

    const client = await createClient()
    const service = createIngestionService(createIngestionDeps(client))

    try {
      const result = await service.createPendingFileSource({
        notebookId: data.notebookId,
        userId: user.id,
        title: data.title,
        fileName: data.fileName,
        fileType: detected.type,
        contentHash: data.contentHash,
      })
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: result }
    } catch (error) {
      return { error: getErrorMessage(error, "create-file-source-action") }
    }
  },
  { auth: true, schema: CreateFileSourceSchema }
)

/**
 * Called by the client once it has finished uploading the file directly to
 * Storage (AC-10) — enqueues the processing job and returns immediately;
 * the pipeline itself runs only in the worker's next tick.
 */
export const processSourceAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ enqueued: true }>> => {
    try {
      const client = await createClient()
      // enqueue_ingestion_job is service_role-only (Eng-Review C1) — the
      // service's own getOwnedSource check below still runs against `client`
      // (RLS-scoped), the admin client is used ONLY for the enqueue RPC call
      // that follows it. See lib/ingestion/deps.ts's `enqueueClient` doc.
      // Constructed inside this try (not before it, like the plain
      // `createClient()` calls elsewhere) because `createAdminClient()`
      // itself can throw — a missing `SUPABASE_SERVICE_ROLE_KEY` — and that
      // needs the same specific "process-source-action" message below, not
      // enhanceAction's generic fallback.
      const service = createIngestionService(
        createIngestionDeps(client, { enqueueClient: createAdminClient() })
      )

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
    try {
      const client = await createClient()
      // See processSourceAction above — the row insert itself is still
      // RLS-scoped (`client`), only the enqueue RPC needs service_role.
      // Constructed inside this try — see processSourceAction's comment on
      // why `createAdminClient()` can't stay outside it.
      const service = createIngestionService(
        createIngestionDeps(client, { enqueueClient: createAdminClient() })
      )

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
    try {
      const client = await createClient()
      // See processSourceAction above — the row insert itself is still
      // RLS-scoped (`client`), only the enqueue RPC needs service_role.
      // Constructed inside this try — see processSourceAction's comment on
      // why `createAdminClient()` can't stay outside it.
      const service = createIngestionService(
        createIngestionDeps(client, { enqueueClient: createAdminClient() })
      )

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

/**
 * Hands the reader a short-lived signed URL for an image source's file.
 *
 * A Server Action rather than a public bucket or a route handler: the
 * `sources` bucket is private, and the owner has to be resolved from the
 * session (`user.id`) instead of trusted from the request, exactly like
 * every other action here. The service additionally re-checks ownership and
 * that the source really is an image before signing anything.
 */
export const getSourceImageUrlAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ url: string }>> => {
    const client = await createClient()
    const service = createIngestionService(createIngestionDeps(client))

    try {
      const url = await service.createSourceImageUrl({
        sourceId: data.sourceId,
        userId: user.id,
      })
      return { data: { url } }
    } catch (error) {
      return { error: getErrorMessage(error, "source-image-url-action") }
    }
  },
  { auth: true, schema: SourceImageUrlSchema }
)

export const retrySourceAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ enqueued: true }>> => {
    try {
      const client = await createClient()
      // See processSourceAction above — retrySource's own getOwnedSource
      // check still runs against `client` (RLS-scoped), only the enqueue RPC
      // needs service_role. Constructed inside this try — see
      // processSourceAction's comment on why `createAdminClient()` can't
      // stay outside it.
      const service = createIngestionService(
        createIngestionDeps(client, { enqueueClient: createAdminClient() })
      )

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
      const { notebookId } = await service.deleteSource({
        sourceId: data.sourceId,
        userId: user.id,
      })
      // Part A (empty-chat summary): a deleted source invalidates the
      // notebook's cached summary — `invalidateNotebookSummary` is
      // best-effort/never-throwing on its own, so this can't turn a
      // successful delete (the row is already gone above) into a reported
      // failure.
      await invalidateNotebookSummary(client, notebookId)
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: { success: true } }
    } catch (error) {
      return { error: getErrorMessage(error, "delete-source-action") }
    }
  },
  { auth: true, schema: DeleteSourceSchema }
)
