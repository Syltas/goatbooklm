import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/database.types"

import { chunkText } from "./chunker"
import { embedChunks } from "./embed"
import {
  assertSafeUrl,
  extractPdfText,
  extractWebText,
  fetchWebPage,
} from "./extract"
import { enqueueIngestionJob } from "./queue"
import type { IngestionDeps } from "./service"

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
    extractPdfText,
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

    async enqueueJob(sourceId: string): Promise<void> {
      // Ownership over `sourceId` must already be established by the caller
      // (via `supabase`, the RLS-scoped client) BEFORE this runs — this
      // function itself performs no check, it only has permission to talk
      // to the queue at all (see the `enqueueClient` doc comment above).
      await enqueueIngestionJob(enqueueClient, sourceId)
    },
  }
}
