import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/database.types"

import { chunkText } from "./chunker"
import { embedChunks } from "./embed"
import { assertSafeUrl, extractPdfText, extractWebText, fetchWebPage } from "./extract"
import { extractCsv } from "./extractors/csv"
import { extractDocx } from "./extractors/docx"
import { extractImage } from "./extractors/image"
import { extractPlainText } from "./extractors/plain-text"
import type { FileExtractor } from "./extractors/types"
import { extractXlsx } from "./extractors/xlsx"
import type { FileSourceType } from "./formats"
import { enqueueIngestionJob } from "./queue"
import type { IngestionDeps } from "./service"

/**
 * The production extraction registry — one head per file format, keyed by
 * `sources.type`. `Record<FileSourceType, …>` is load-bearing: adding a
 * member to `FileSourceType` without adding its head here is a compile
 * error, so a format can never reach the pipeline with nothing to extract
 * it (which would previously have surfaced only at runtime, as a source
 * stuck in `error`).
 *
 * PDF is adapted rather than rewritten: `extractPdfText` predates the
 * registry and takes bare bytes while returning the one extra field only it
 * produces (`pageOffsets`, for `chunks.metadata.page`).
 */
const FILE_EXTRACTORS: Record<FileSourceType, FileExtractor> = {
  pdf: async ({ bytes }) => extractPdfText(bytes),
  txt: extractPlainText,
  md: extractPlainText,
  csv: extractCsv,
  docx: extractDocx,
  xlsx: extractXlsx,
  image: extractImage,
}

const SOURCES_BUCKET = "sources"

/**
 * Wires the real, production `IngestionDeps` (specs/02-ingestion.md §9) for
 * a given Supabase client — the request-scoped user client for Server
 * Actions (create/enqueue/retry/delete, all RLS-scoped + ownership-checked
 * in the service layer), or the admin client for the worker Route Handler
 * (`runIngestionJob`, no acting user by design). One factory, parameterized
 * by client, so `app/(app)/notebooks/[notebookId]/sources/actions.ts` and
 * `app/api/ingestion-worker/route.ts` don't each hand-assemble the same
 * dependency object (service-builder DI convention: the *service* never
 * imports a client, but this wiring layer — same as an action or route
 * handler would inline — legitimately does).
 *
 * `enqueueClient` (Eng-Review C1, 2026-07-19): `enqueue_ingestion_job` is now
 * service_role-only (see migration `20260719150855_expose_pgmq_rpc.sql`'s
 * updated grants) — an `authenticated`-scoped client can no longer call it
 * at all. Server Actions must therefore bind a separate admin client for
 * *just* the enqueue call, while every read/write that establishes
 * ownership (`getOwnedSource`, the RLS-`with check`'d insert) still goes
 * through the request-scoped `supabase` client passed as the first
 * argument. Defaults to `supabase` itself so the worker Route Handler
 * (already passing its own admin client as `supabase`) needs no change.
 */
export function createIngestionDeps(
  supabase: SupabaseClient<Database>,
  opts: { enqueueClient?: SupabaseClient<Database> } = {}
): IngestionDeps {
  const enqueueClient = opts.enqueueClient ?? supabase

  return {
    supabase,
    fileExtractors: FILE_EXTRACTORS,
    assertSafeUrl,
    fetchWebPage,
    extractWebText,
    chunkText,
    embedChunks,

    async downloadStorageFile(path: string): Promise<Uint8Array> {
      const { data, error } = await supabase.storage
        .from(SOURCES_BUCKET)
        .download(path)
      if (error) throw error
      return new Uint8Array(await data.arrayBuffer())
    },

    async deleteStorageFile(path: string): Promise<void> {
      const { error } = await supabase.storage
        .from(SOURCES_BUCKET)
        .remove([path])
      if (error) throw error
    },

    async storageFileExists(path: string): Promise<boolean> {
      const lastSlash = path.lastIndexOf("/")
      const folder = lastSlash === -1 ? "" : path.slice(0, lastSlash)
      const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1)

      const { data, error } = await supabase.storage
        .from(SOURCES_BUCKET)
        .list(folder, { search: fileName })
      if (error) throw error

      return (data ?? []).some((entry) => entry.name === fileName)
    },

    async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
      const { data, error } = await supabase.storage
        .from(SOURCES_BUCKET)
        .createSignedUrl(path, expiresInSeconds)
      if (error) throw error
      // Supabase types `signedUrl` as optional on the success branch; a
      // success with no URL would otherwise return `undefined` to the reader
      // and render a broken image with no explanation.
      if (!data?.signedUrl) throw new Error("Signed URL konnte nicht erstellt werden.")
      return data.signedUrl
    },

    async enqueueJob(sourceId: string): Promise<void> {
      // Ownership over `sourceId` must already be established by the caller
      // (via `supabase`, the RLS-scoped client) BEFORE this runs — this
      // function itself performs no check, it only has permission to talk
      // to the queue at all (see the `enqueueClient` doc comment above).
      await enqueueIngestionJob(enqueueClient, sourceId)
    },
  }
}
