import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Json } from "@/lib/database.types"

import type { Chunk } from "./chunker"
import type { PageOffset } from "./extract"
import { INGESTION_MESSAGES } from "./messages"
import { isStalePending, isStaleProcessing } from "./source-status"

export type Source = Database["public"]["Tables"]["sources"]["Row"]

type SourceInsert = Database["public"]["Tables"]["sources"]["Insert"]
type SourceUpdate = Database["public"]["Tables"]["sources"]["Update"]
type ChunkInsert = Database["public"]["Tables"]["chunks"]["Insert"]

// Re-exported for backwards compatibility — this used to be defined inline
// here; it now lives in `./messages` (zero-dependency, safe for client
// components to import directly — see that module's docstring) and is just
// re-exported from its original home so existing imports (`./service.ts`'s
// own test suite included) keep working unchanged.
export { INGESTION_MESSAGES }

/**
 * Carries an already-German, user-facing message straight through to
 * `sources.error_message`. Thrown for failure modes with a *fixed* message
 * per the Fehler-Matrix, regardless of the underlying cause (e.g. any PDF
 * parse failure -> the same "beschädigt oder passwortgeschützt" message).
 * Errors thrown by `fetchWebPage`/`extractWebText`/`assertSafeUrl` already
 * carry the correct matrix message themselves and are left to propagate
 * unwrapped.
 */
class IngestionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "IngestionError"
  }
}

/**
 * Thrown when a source row referenced by id no longer exists — e.g. the
 * worker dequeues a job for a source the user already deleted (Eng-Review
 * M1). A distinct class (not a plain `Error` with the `notFound` message
 * string) so callers like `processIngestionTick` (`lib/ingestion/worker.ts`)
 * can detect this specific, terminal condition via `instanceof` rather than
 * comparing `.message` against a magic string.
 */
export class SourceNotFoundError extends Error {
  constructor() {
    super(INGESTION_MESSAGES.notFound)
    this.name = "SourceNotFoundError"
  }
}

const MAX_PDF_BYTES = 20_971_520
const PDF_MAGIC_BYTES = "%PDF-"

/**
 * Dependencies injected into the ingestion service — the Supabase client
 * plus every I/O-touching step of the pipeline (extraction, embedding,
 * storage, queueing). None of these are imported directly by the service,
 * so it runs identically from a Server Action, the worker Route Handler, or
 * a test with stubs (service-builder pattern).
 *
 * Interface note for the follow-up worker/actions agent: this splits the
 * original spec pseudocode's single `extractWebText(url)` into
 * `assertSafeUrl` (sync pre-check) + `fetchWebPage` (network, manual
 * redirect loop, per-hop SSRF check) + `extractWebText(html, url)` (pure
 * HTML -> text). Wire the real implementations from `./extract.ts` for
 * `extractPdfText`/`assertSafeUrl`/`fetchWebPage`/`extractWebText`, `./chunker.ts`
 * for `chunkText`, `./embed.ts`'s `embedChunks` for `embedChunks`, real
 * Supabase Storage calls for `downloadStorageFile`/`deleteStorageFile`, and
 * a `pgmq.send('ingestion_jobs', { source_id })` wrapper for `enqueueJob`
 * (that pgmq binding itself is explicitly NOT built here — see task scope).
 */
export interface IngestionDeps {
  supabase: SupabaseClient<Database>
  extractPdfText: (
    bytes: Uint8Array
  ) => Promise<{ text: string; pageOffsets: PageOffset[] }>
  assertSafeUrl: (url: string) => Promise<void>
  fetchWebPage: (url: string) => Promise<{ html: string; finalUrl: string }>
  extractWebText: (html: string, url: string) => { text: string; title?: string }
  chunkText: (text: string) => Chunk[]
  embedChunks: (texts: string[]) => Promise<number[][]>
  downloadStorageFile: (path: string) => Promise<Uint8Array>
  deleteStorageFile: (path: string) => Promise<void>
  /** Eng-Review M2: does a Storage object at this path actually exist? Used
   *  by `retrySource` to distinguish "PDF upload finished, only the enqueue
   *  got lost" (safe to retry) from "PDF upload never finished" (nothing to
   *  retry) for a stale-`pending` source. */
  storageFileExists: (path: string) => Promise<boolean>
  /** pgmq.send-wrapper, injected/stubbable — see interface note above. */
  enqueueJob: (sourceId: string) => Promise<void>
}

export function createIngestionService(deps: IngestionDeps) {
  return new IngestionService(deps)
}

class IngestionService {
  private readonly client: SupabaseClient<Database>

  constructor(private readonly deps: IngestionDeps) {
    this.client = deps.supabase
  }

  // ---------------------------------------------------------------------
  // Create (called from Server Actions — always ends with status='pending'
  // and a queued job; the pipeline itself only ever runs in runIngestionJob)
  // ---------------------------------------------------------------------

  async createPendingPdfSource(data: {
    notebookId: string
    userId: string
    title: string
    fileName: string
  }): Promise<{ sourceId: string; storagePath: string }> {
    void data.fileName

    const sourceId = crypto.randomUUID()
    const storagePath = `${data.userId}/${sourceId}.pdf`

    const insert: SourceInsert = {
      id: sourceId,
      notebook_id: data.notebookId,
      user_id: data.userId,
      type: "pdf",
      title: data.title,
      status: "pending",
      storage_path: storagePath,
    }

    const { data: row, error } = await this.client
      .from("sources")
      .insert(insert)
      .select()
      .single()

    if (error) throw error

    return { sourceId: row.id, storagePath }
  }

  /**
   * Called by `processSourceAction` (PDF path) once the client has
   * finished uploading the file directly to Storage — enqueues the
   * processing job, does NOT run the pipeline itself (Queue-Rearchitektur,
   * §4 Punkt 1).
   */
  async enqueueIngestionJob(data: {
    sourceId: string
    userId: string
  }): Promise<void> {
    const source = await this.getOwnedSource(data.sourceId, data.userId)
    await this.deps.enqueueJob(source.id)
  }

  async createTextSource(data: {
    notebookId: string
    userId: string
    title: string
    text: string
  }): Promise<Source> {
    const insert: SourceInsert = {
      notebook_id: data.notebookId,
      user_id: data.userId,
      type: "text",
      title: data.title,
      content_text: data.text,
      status: "pending",
    }

    const { data: row, error } = await this.client
      .from("sources")
      .insert(insert)
      .select()
      .single()

    if (error) throw error

    await this.deps.enqueueJob(row.id)

    return row
  }

  async createWebSource(data: {
    notebookId: string
    userId: string
    url: string
    title?: string
  }): Promise<Source> {
    // Fail-fast pre-check (AC-14/AC-15): reject an obviously unsafe URL
    // before any row exists. The full per-hop redirect guard still runs at
    // actual fetch time inside runIngestionJob, since redirect targets
    // aren't known yet.
    await this.deps.assertSafeUrl(data.url)

    const title = data.title?.trim() || hostnameFallbackTitle(data.url)

    const insert: SourceInsert = {
      notebook_id: data.notebookId,
      user_id: data.userId,
      type: "web",
      title,
      url: data.url,
      status: "pending",
    }

    const { data: row, error } = await this.client
      .from("sources")
      .insert(insert)
      .select()
      .single()

    if (error) throw error

    await this.deps.enqueueJob(row.id)

    return row
  }

  // ---------------------------------------------------------------------
  // Worker pipeline — invoked ONLY by the ingestion worker Route Handler,
  // never directly from a client-facing Server Action (§9 Worker-Contract).
  // No userId/ownership check here: the worker has no acting user, it just
  // drains whatever the queue hands it.
  // ---------------------------------------------------------------------

  async runIngestionJob(data: { sourceId: string }): Promise<Source> {
    const source = await this.getSourceById(data.sourceId)
    if (!source) throw new SourceNotFoundError()

    await this.updateSource(source.id, { status: "processing", error_message: null })

    try {
      const extraction = await this.extractContent(source)
      const chunks = this.deps.chunkText(extraction.contentText)

      if (chunks.length === 0) {
        throw new IngestionError(INGESTION_MESSAGES.noReadableText)
      }

      let embeddings: number[][]
      try {
        embeddings = await this.deps.embedChunks(chunks.map((c) => c.content))
      } catch {
        throw new IngestionError(INGESTION_MESSAGES.embedFailed)
      }

      const rows: ChunkInsert[] = chunks.map((chunk, i) => ({
        source_id: source.id,
        notebook_id: source.notebook_id,
        user_id: source.user_id,
        chunk_index: chunk.index,
        content: chunk.content,
        embedding: toPgVector(embeddings[i]),
        metadata: buildChunkMetadata(chunk, source.type, extraction.pageOffsets),
      }))

      // Eng-Review L2: clear any chunks already persisted for this source
      // before inserting the fresh batch. Makes a second full run of this
      // pipeline against the same source idempotent — REPLACE semantics
      // instead of either duplicate rows or a unique-constraint violation on
      // (source_id, chunk_index) — which matters because a stale-processing
      // race (§ M2: a status update lost after the job actually finished)
      // can leave a source picked up and reprocessed a second time even
      // though its first run already persisted chunks.
      const { error: preDeleteError } = await this.client
        .from("chunks")
        .delete()
        .eq("source_id", source.id)
      if (preDeleteError) throw preDeleteError

      const { error: insertError } = await this.client.from("chunks").insert(rows)

      if (insertError) {
        // Rollback-by-delete (§4 Punkt 3): the atomic single-statement
        // insert above should mean nothing landed anyway, but this makes
        // the "no partial chunks survive a failed persist" guarantee
        // explicit and testable regardless of driver/transaction behavior.
        await this.client.from("chunks").delete().eq("source_id", source.id)
        throw new IngestionError(INGESTION_MESSAGES.persistFailed)
      }

      const updatePayload: SourceUpdate = {
        status: "ready",
        error_message: null,
        content_text: extraction.contentText,
      }
      // AC-16: only backfill the title from extraction when the source is
      // still carrying the hostname fallback createWebSource assigned it
      // (i.e. the user did not supply an explicit title) — never overwrite
      // a user-chosen title.
      if (
        source.type === "web" &&
        extraction.title &&
        source.title === hostnameFallbackTitle(source.url ?? "")
      ) {
        updatePayload.title = extraction.title
      }

      const { data: updated, error: updateError } = await this.client
        .from("sources")
        .update(updatePayload)
        .eq("id", source.id)
        .select()
        .single()

      if (updateError) throw updateError
      return updated
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : INGESTION_MESSAGES.processingFailedGeneric

      const { data: failed, error: failError } = await this.client
        .from("sources")
        .update({ status: "error", error_message: message })
        .eq("id", source.id)
        .select()
        .single()

      if (failError) throw failError
      return failed
    }
  }

  private async extractContent(source: Source): Promise<{
    contentText: string
    pageOffsets: PageOffset[]
    title?: string
  }> {
    if (source.type === "pdf") {
      if (!source.storage_path) {
        throw new IngestionError(INGESTION_MESSAGES.pdfCorrupt)
      }

      let bytes: Uint8Array
      try {
        bytes = await this.deps.downloadStorageFile(source.storage_path)
      } catch {
        throw new IngestionError(INGESTION_MESSAGES.pdfCorrupt)
      }

      // Eng-Review M3: verify the downloaded bytes actually start with the
      // PDF magic number before doing anything else with them. The Storage
      // bucket's `allowed_mime_types` only constrains what the client
      // *claims* the file is at upload time (a client-supplied
      // content-type, trivially spoofable) — it does not guarantee the
      // bytes themselves are a PDF. Checking this explicitly, with a fixed
      // German error message, is more predictable than relying on `unpdf`
      // to fail cleanly on arbitrary non-PDF input.
      const magic = Buffer.from(bytes.subarray(0, PDF_MAGIC_BYTES.length)).toString(
        "latin1"
      )
      if (magic !== PDF_MAGIC_BYTES) {
        throw new IngestionError(INGESTION_MESSAGES.pdfCorrupt)
      }

      // AC-40: re-validate the actual downloaded size server-side — the
      // client-supplied size in CreatePdfSourceSchema is not trustworthy.
      if (bytes.byteLength > MAX_PDF_BYTES) {
        throw new IngestionError(INGESTION_MESSAGES.sizeLimitExceeded)
      }

      let extracted: { text: string; pageOffsets: PageOffset[] }
      try {
        extracted = await this.deps.extractPdfText(bytes)
      } catch {
        throw new IngestionError(INGESTION_MESSAGES.pdfCorrupt)
      }

      if (extracted.text.trim().length === 0) {
        throw new IngestionError(INGESTION_MESSAGES.pdfEmpty)
      }

      return { contentText: extracted.text, pageOffsets: extracted.pageOffsets }
    }

    if (source.type === "web") {
      if (!source.url) throw new IngestionError(INGESTION_MESSAGES.ssrfBlocked)

      // Re-check immediately before fetching too (AC-32: retry re-fetches,
      // and the pre-check at createWebSource time may be stale by then).
      await this.deps.assertSafeUrl(source.url)

      const fetched = await this.deps.fetchWebPage(source.url)
      const extracted = this.deps.extractWebText(fetched.html, fetched.finalUrl)

      return {
        contentText: extracted.text,
        pageOffsets: [],
        title: extracted.title,
      }
    }

    // type === 'text': content_text was already populated at creation time.
    const contentText = source.content_text ?? ""
    if (contentText.trim().length === 0) {
      throw new IngestionError(INGESTION_MESSAGES.noReadableText)
    }
    return { contentText, pageOffsets: [] }
  }

  // ---------------------------------------------------------------------
  // Retry / Delete
  // ---------------------------------------------------------------------

  /**
   * Retry guard (Eng-Review M2): allowed for a real `error`, a stale
   * `processing` row (AC-41 exception — see `source-status.ts`), or now
   * also a stale `pending` row (the enqueue/pickup never happened or got
   * lost). Everything else (a `processing`/`pending` row that ISN'T yet
   * stale, or an already-`ready` row) is rejected — retrying those would
   * either race an in-flight job or be a no-op.
   *
   * A stale-`pending` PDF source needs one extra check the other cases
   * don't: `pending` for a PDF means "row created, waiting on the client's
   * *direct-to-Storage* upload to finish" (see `createPendingPdfSource` /
   * `processSourceAction`) — if that upload itself never completed, there
   * is no file in Storage for the worker to ever download, and blindly
   * re-enqueueing would just fail the exact same way again. So: does the
   * Storage object actually exist? Yes → the upload *did* finish, only the
   * enqueue/pickup got lost — safe to retry normally. No → nothing to
   * retry; tell the user to delete this source and upload again.
   */
  async retrySource(data: { sourceId: string; userId: string }): Promise<Source> {
    const source = await this.getOwnedSource(data.sourceId, data.userId)

    const staleProcessing = isStaleProcessing(source)
    const stalePending = isStalePending(source)

    if (source.status !== "error" && !staleProcessing && !stalePending) {
      throw new Error(INGESTION_MESSAGES.processingInProgress)
    }

    if (stalePending && source.type === "pdf") {
      const uploadCompleted =
        !!source.storage_path && (await this.deps.storageFileExists(source.storage_path))
      if (!uploadCompleted) {
        throw new IngestionError(INGESTION_MESSAGES.stalePendingNoUpload)
      }
    }

    const { data: updated, error } = await this.client
      .from("sources")
      .update({ status: "pending", error_message: null })
      .eq("id", data.sourceId)
      .select()
      .single()

    if (error) throw error

    await this.deps.enqueueJob(data.sourceId)

    return updated
  }

  async deleteSource(data: { sourceId: string; userId: string }): Promise<void> {
    const source = await this.getOwnedSource(data.sourceId, data.userId)

    const { error } = await this.client.from("sources").delete().eq("id", data.sourceId)
    if (error) throw error

    if (source.type === "pdf" && source.storage_path) {
      await this.deps.deleteStorageFile(source.storage_path)
    }
  }

  /**
   * Called from the Notebook-delete flow (Spec 01,
   * `app/(app)/notebooks/actions.ts`'s `deleteNotebookAction`) BEFORE the
   * notebook (and its cascaded `sources`) rows are deleted — storage paths
   * must be read while the `sources` rows still exist, since the FK cascade
   * wipes them out along with the notebook.
   *
   * Read-only, deliberately split from the actual Storage delete
   * (`deleteStorageObjects` below) — Eng-Review L1: the two steps must run
   * on either side of the DB delete, not both before it. Reading paths then
   * deleting the Storage objects immediately (the original ordering) meant
   * a DB-delete failure *after* Storage objects were already gone would
   * leave `sources` rows pointing at files that no longer exist. Read →
   * DB-delete → Storage-delete-best-effort means the only failure mode left
   * is the opposite (an orphaned, harmless Storage object with no row
   * pointing at it), which the notebook-delete flow already accepts as the
   * cost of "best-effort, never blocks the user-visible delete".
   */
  async getNotebookPdfStoragePaths(data: {
    notebookId: string
    userId: string
  }): Promise<string[]> {
    void data.userId

    const { data: rows, error } = await this.client
      .from("sources")
      .select("storage_path")
      .eq("notebook_id", data.notebookId)
      .eq("type", "pdf")
      .not("storage_path", "is", null)

    if (error) throw error

    return (rows ?? [])
      .map((row) => row.storage_path)
      .filter((path): path is string => Boolean(path))
  }

  /**
   * Best-effort Storage cleanup for a list of already-known paths (see
   * `getNotebookPdfStoragePaths` above) — call this AFTER the DB delete has
   * already happened. Never throws: an individual Storage delete failure is
   * logged only, since by the time this runs the DB delete the user is
   * waiting on has already succeeded and must not be blocked/rolled back by
   * a Storage-layer failure.
   */
  async deleteStorageObjects(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        await this.deps.deleteStorageFile(path)
      } catch (err) {
        console.error(`[ingestion] failed to delete storage object ${path}:`, err)
      }
    }
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private async getSourceById(sourceId: string): Promise<Source | null> {
    const { data, error } = await this.client
      .from("sources")
      .select("*")
      .eq("id", sourceId)
      .maybeSingle()

    if (error) throw error
    return data
  }

  /**
   * RLS already scopes `sources` rows to their owner, but a malicious/stale
   * `sourceId` for another user's row must be rejected explicitly here too
   * (DoD-Auth): RLS alone would just return an empty result for a row that
   * exists-but-isn't-yours, which reads identically to "row does not
   * exist" — both collapse to the same "not found" error from the caller's
   * perspective, which is the desired fail-closed behavior either way.
   */
  private async getOwnedSource(sourceId: string, userId: string): Promise<Source> {
    const source = await this.getSourceById(sourceId)
    if (!source || source.user_id !== userId) {
      throw new SourceNotFoundError()
    }
    return source
  }

  private async updateSource(sourceId: string, patch: SourceUpdate): Promise<void> {
    const { error } = await this.client.from("sources").update(patch).eq("id", sourceId)
    if (error) throw error
  }
}

function hostnameFallbackTitle(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** pgvector's text input format: `[v1,v2,...]`. The generated Supabase
 *  `Insert` type for `chunks.embedding` is `string | null` (pgvector wire
 *  format is textual), not `number[]`. */
function toPgVector(values: number[]): string {
  return `[${values.join(",")}]`
}

function buildChunkMetadata(
  chunk: Chunk,
  sourceType: string,
  pageOffsets: PageOffset[]
): Json {
  const metadata: { char_start: number; char_end: number; page?: number } = {
    char_start: chunk.charStart,
    char_end: chunk.charEnd,
  }

  if (sourceType === "pdf") {
    // Eng-Review L4: `pageOffsets` entries cover only each page's own text
    // ([charStart, charEnd) — see `extractPdfText`), NOT the `\n\n`
    // separator `extractPdfText` joins pages with. A chunk boundary that
    // lands inside that separator gap (a real, if narrow, possibility —
    // chunk boundaries are token-driven, not page-aware) would match no
    // entry under a strict `charStart < p.charEnd` range check and silently
    // get no `page` at all. Instead: take the LAST page whose `charStart`
    // is still `<= chunk.charStart` — since `pageOffsets` is always in
    // ascending `charStart` order, this attributes any gap/separator
    // position to the page immediately preceding it, which is the correct
    // page for that chunk's content either way (the separator itself isn't
    // "on" any page, but a chunk starting there is presented right after
    // the preceding page's text).
    let page: PageOffset | undefined
    for (const p of pageOffsets) {
      if (p.charStart > chunk.charStart) break
      page = p
    }
    if (page) metadata.page = page.page
  }

  return metadata
}
