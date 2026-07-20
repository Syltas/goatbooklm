import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Json } from "@/lib/database.types"

import type { Chunk } from "./chunker"
import type { FileExtraction, FileExtractorInput } from "./extractors/types"
import type { PageOffset } from "./extract"
import {
  FILE_FORMATS,
  fileExtension,
  isFileSourceType,
  matchesMagic,
  type FileSourceType,
} from "./formats"
import { sha256Hex, sha256HexOfText } from "./hash"
import { FORMAT_MESSAGES, INGESTION_MESSAGES } from "./messages"
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

/**
 * Thrown when a source's content hash collides with another source already
 * in the same notebook (content-hash dedupe), racing the
 * `unique(notebook_id, content_hash)` constraint from
 * `20260720133000_add_sources_content_hash.sql`.
 *
 * Three kinds of call site reach it, and all three name the existing source
 * rather than failing generically — naming it is the whole point: the
 * incident this responds to had two sources under different titles holding
 * the same document, and "already exists" would not have made that visible.
 *
 *  - `createPendingFileSource` / `createTextSource` — create-time
 *    pre-check (best-effort; avoids a wasted Storage upload in the common,
 *    non-racing case), plus unique-violation handling for the lost race.
 *  - `reconcileContentHash` in the worker — the authoritative check. For
 *    files it is the only place the actually-persisted bytes are seen; for
 *    `web` sources it is the only place the hash exists at all, since the
 *    article text is not known until the page has been fetched.
 *
 * The subject noun varies because "Datei" is wrong for a pasted note or a
 * web page, and a message that misnames what the user just added reads like
 * it is about something else.
 */
export class DuplicateSourceError extends Error {
  constructor(existingTitle: string | null, subject: "Datei" | "Quelle" = "Datei") {
    super(
      existingTitle
        ? `Diese ${subject} ist identisch mit „${existingTitle}“.`
        : `Diese ${subject} ist bereits in diesem Notizbuch vorhanden.`
    )
    this.name = "DuplicateSourceError"
  }
}

/** Postgres `unique_violation` SQLSTATE — PostgREST/Supabase surface it as
 *  `error.code === "23505"` on an insert/update that collides with
 *  `sources_notebook_id_content_hash_key`. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  )
}

/**
 * Dependencies injected into the ingestion service — the Supabase client
 * plus every I/O-touching step of the pipeline (extraction, embedding,
 * storage, queueing). None of these are imported directly by the service,
 * so it runs identically from a Server Action, the worker Route Handler, or
 * a test with stubs (service-builder pattern).
 *
 * Interface note: this splits the original spec pseudocode's single
 * `extractWebText(url)` into `assertSafeUrl` (sync pre-check) +
 * `fetchWebPage` (network, manual redirect loop, per-hop SSRF check) +
 * `extractWebText(html, url)` (pure HTML -> text). Wire the real
 * implementations from `./extract.ts` for
 * `assertSafeUrl`/`fetchWebPage`/`extractWebText`, `./chunker.ts` for
 * `chunkText`, `./embed.ts`'s `embedChunks` for `embedChunks`, real
 * Supabase Storage calls for `downloadStorageFile`/`deleteStorageFile`, and
 * a `pgmq.send('ingestion_jobs', { source_id })` wrapper for `enqueueJob`
 * (that pgmq binding itself is explicitly NOT built here — see task scope).
 */
export interface IngestionDeps {
  supabase: SupabaseClient<Database>
  /**
   * Extraction registry — one head per file-backed source type, keyed by
   * `sources.type`. Replaces the previous single `extractPdfText` field.
   *
   * A named-per-format field (`extractPdfText`, `extractDocxText`, …) would
   * have forced `extractContent` to grow a branch per format and every test
   * stub to grow a field per format. Keying by type means the service picks
   * a head by lookup and never names a format: adding one is an entry in
   * `formats.ts` plus an entry here, with no change to the service at all.
   */
  fileExtractors: Record<FileSourceType, (input: FileExtractorInput) => Promise<FileExtraction>>
  assertSafeUrl: (url: string) => Promise<void>
  fetchWebPage: (url: string) => Promise<{ html: string; finalUrl: string }>
  extractWebText: (html: string, url: string) => { text: string; title?: string }
  chunkText: (text: string) => Chunk[]
  embedChunks: (texts: string[]) => Promise<number[][]>
  downloadStorageFile: (path: string) => Promise<Uint8Array>
  deleteStorageFile: (path: string) => Promise<void>
  /** Eng-Review M2: does a Storage object at this path actually exist? Used
   *  by `retrySource` to distinguish "upload finished, only the enqueue got
   *  lost" (safe to retry) from "upload never finished" (nothing to retry)
   *  for a stale-`pending` source of ANY file-backed type. */
  storageFileExists: (path: string) => Promise<boolean>
  /** Short-lived, signed read URL for a Storage object — used by the reader
   *  to display an image source. Signed rather than public because the
   *  `sources` bucket is private: a signed URL is the only way to hand the
   *  browser a directly-loadable `<img src>` without making the object
   *  readable to anyone who guesses the path. */
  createSignedUrl: (path: string, expiresInSeconds: number) => Promise<string>
  /** pgmq.send-wrapper, injected/stubbable — see interface note above. */
  enqueueJob: (sourceId: string) => Promise<void>
}

/** Lifetime of a reader image URL — long enough to load the image (and to
 *  survive a slow connection or a brief tab switch), short enough that a URL
 *  copied out of devtools stops working quickly. */
const SIGNED_URL_TTL_SECONDS = 300

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

  /**
   * Creates the `pending` row for a file upload of ANY supported format and
   * hands back the Storage path the client should upload to.
   *
   * `fileType` is resolved by the CALLER from the file name + MIME
   * (`detectFileFormat`), server-side in the Server Action — never taken
   * from client input as a declared type, same rule as `userId`.
   */
  async createPendingFileSource(data: {
    notebookId: string
    userId: string
    title: string
    fileName: string
    fileType: FileSourceType
    contentHash: string
  }): Promise<{ sourceId: string; storagePath: string }> {
    // Task 5: best-effort pre-check so an obvious duplicate is rejected
    // before any Storage upload even starts, naming the existing source —
    // NOT sufficient by itself (two concurrent uploads of the same file
    // both pass this SELECT before either INSERT lands, the exact race the
    // unique constraint below exists for) — a race lost here is caught by
    // the insert's own unique-violation handling and reported identically.
    const existing = await this.findDuplicateByHash(data.notebookId, data.contentHash)
    if (existing) throw new DuplicateSourceError(existing.title)

    const sourceId = crypto.randomUUID()
    // The Storage path used to hard-code `.pdf`. It now carries the real
    // extension, which matters beyond tidiness: the reader serves image
    // sources straight from Storage, and a `.pdf`-suffixed PNG would be
    // served with the wrong content type by Storage's own extension-based
    // sniffing. Falls back to the format's canonical extension when the
    // upload name has none.
    const storagePath = `${data.userId}/${sourceId}${storageExtension(
      data.fileName,
      data.fileType
    )}`

    const insert: SourceInsert = {
      id: sourceId,
      notebook_id: data.notebookId,
      user_id: data.userId,
      type: data.fileType,
      title: data.title,
      status: "pending",
      storage_path: storagePath,
      content_hash: data.contentHash,
    }

    const { data: row, error } = await this.client
      .from("sources")
      .insert(insert)
      .select()
      .single()

    if (error) {
      if (isUniqueViolation(error)) {
        const conflict = await this.findDuplicateByHash(data.notebookId, data.contentHash)
        throw new DuplicateSourceError(conflict?.title ?? null)
      }
      throw error
    }

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
    await this.enqueueOrMarkFailed(source.id)
  }

  /**
   * Dedupe for `text` sources (pasted text and "Notiz zu Quelle machen").
   *
   * This path previously never set `content_hash` at all, and because
   * Postgres treats every NULL in a unique index as distinct from every
   * other NULL, `sources_notebook_id_content_hash_key` did not fire for
   * them: the same note could be converted to a source twice, or the same
   * text pasted twice, producing two independent sources with no warning.
   * That is the same silent corpus-duplication the PDF dedupe was built for
   * — it halves the effective top-k, because two identical sources return
   * the same passage twice for one query slot.
   *
   * Unlike web sources, a text source's extracted text is fully known at
   * creation time (it IS the submitted text), so the check runs here and the
   * duplicate is refused synchronously, naming the existing source, instead
   * of creating a row that only fails later in the worker.
   */
  async createTextSource(data: {
    notebookId: string
    userId: string
    title: string
    text: string
  }): Promise<Source> {
    const contentHash = await sha256HexOfText(data.text)

    const existing = await this.findDuplicateByHash(data.notebookId, contentHash)
    if (existing) throw new DuplicateSourceError(existing.title, "Quelle")

    const insert: SourceInsert = {
      notebook_id: data.notebookId,
      user_id: data.userId,
      type: "text",
      title: data.title,
      content_text: data.text,
      content_hash: contentHash,
      status: "pending",
    }

    const { data: row, error } = await this.client
      .from("sources")
      .insert(insert)
      .select()
      .single()

    if (error) {
      // Same lost-race handling as `createPendingFileSource`: two concurrent
      // submissions of identical text both pass the SELECT above, and the
      // loser must still get the named-duplicate message rather than a raw
      // constraint error.
      if (isUniqueViolation(error)) {
        const conflict = await this.findDuplicateByHash(data.notebookId, contentHash)
        throw new DuplicateSourceError(conflict?.title ?? null, "Quelle")
      }
      throw error
    }

    await this.enqueueOrMarkFailed(row.id)

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

    await this.enqueueOrMarkFailed(row.id)

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

  /**
   * Resolves a source to its extracted text, regardless of type.
   *
   * The file branch is deliberately format-agnostic: it runs the SAME six
   * steps (download → magic-check → hash-reconcile → size-check → extract →
   * empty-check) for every file-backed type, reading the format's specifics
   * (magic bytes, byte cap, error wording, extraction head) out of the
   * registry. Previously this branch was `if (source.type === "pdf")` with
   * every one of those specifics inlined as a PDF constant, which is why a
   * new format could not be added without touching the pipeline itself.
   */
  private async extractContent(source: Source): Promise<{
    contentText: string
    pageOffsets: PageOffset[]
    title?: string
  }> {
    if (isFileSourceType(source.type)) {
      return this.extractFileContent(source, source.type)
    }

    if (source.type === "web") {
      if (!source.url) throw new IngestionError(INGESTION_MESSAGES.ssrfBlocked)

      // Re-check immediately before fetching too (AC-32: retry re-fetches,
      // and the pre-check at createWebSource time may be stale by then).
      await this.deps.assertSafeUrl(source.url)

      const fetched = await this.deps.fetchWebPage(source.url)
      const extracted = this.deps.extractWebText(fetched.html, fetched.finalUrl)

      // Dedupe for web sources. Unlike a file, the hash can only be computed
      // here — the article text is not known until the page has been fetched
      // and stripped of its markup. Hashing the ARTICLE TEXT rather than the
      // response HTML is what makes this stable: the surrounding markup
      // (ads, nav, build hashes, CSRF tokens) changes on nearly every fetch
      // while the article does not, so an HTML-based hash would never match
      // itself and the dedupe would silently never fire.
      //
      // A collision here raises `DuplicateSourceError`, which
      // `runIngestionJob`'s catch-all persists as a clean `status='error'`
      // naming the existing source — never an unhandled constraint failure.
      await this.reconcileContentHash(source, extracted.text)

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
    // Normally a no-op — `createTextSource` already hashed this exact text
    // and refused a duplicate up front. It still runs because a `text` row
    // created before the hash existed (or by a future call site that skips
    // the pre-check) must not silently stay un-deduped.
    await this.reconcileContentHash(source, contentText)
    return { contentText, pageOffsets: [] }
  }

  private async extractFileContent(
    source: Source,
    type: FileSourceType
  ): Promise<{ contentText: string; pageOffsets: PageOffset[] }> {
    const spec = FILE_FORMATS[type]
    const messages = FORMAT_MESSAGES[type]

    // A missing `storage_path` and a `downloadStorageFile` failure both mean
    // the bytes were never looked at — reporting them as a *content*
    // problem would tell the user their file is broken when nothing about it
    // was ever read. Own message per format, and one that hints a retry may
    // simply work (unlike a genuinely corrupt file).
    if (!source.storage_path) {
      throw new IngestionError(messages.downloadFailed)
    }

    let bytes: Uint8Array
    try {
      bytes = await this.deps.downloadStorageFile(source.storage_path)
    } catch {
      throw new IngestionError(messages.downloadFailed)
    }

    // Eng-Review M3, generalized: verify the bytes actually carry the
    // format's signature before doing anything else with them. The Storage
    // bucket's `allowed_mime_types` only constrains what the client *claims*
    // at upload time (a trivially spoofable content-type header); it says
    // nothing about the bytes. Formats without a signature (txt/md/csv) pass
    // this and are caught instead by their decoder, which is strict UTF-8.
    if (!matchesMagic(type, bytes)) {
      // Bytes arrived fine — they just aren't this format at all. Unlike the
      // download failures above, retrying against the same Storage object
      // would fail identically, and the message says so.
      throw new IngestionError(messages.corrupt)
    }

    // Task 6: the worker is the only place that ever sees the bytes actually
    // persisted in Storage — a client-supplied `content_hash` (computed
    // before the direct-to-Storage upload, see `file-upload-tab.tsx`) is
    // only weakly trustworthy per the project's "never trust client input"
    // rule. Recompute from these downloaded bytes; on any mismatch the
    // worker's value wins and is persisted.
    await this.reconcileContentHash(source, bytes)

    // AC-40, per format: re-validate the ACTUAL downloaded size server-side
    // — the client-supplied size in the create schema is not trustworthy,
    // and one shared 20MB constant was the wrong check anyway. A 20MB image
    // and a 20MB PDF cost wildly different things downstream (the image
    // becomes a base64 vision payload), so each format carries its own cap.
    if (bytes.byteLength > spec.maxBytes) {
      throw new IngestionError(INGESTION_MESSAGES.sizeLimitExceeded)
    }

    let extracted: FileExtraction
    try {
      extracted = await this.deps.fileExtractors[type]({
        bytes,
        fileName: source.title,
      })
    } catch (error) {
      // The image head is the one case where a throw is not about the file's
      // structure: the bytes passed the magic check, so the image is valid
      // and it was the vision call that failed (network, rate limit). That
      // is retryable and must not be reported as a broken file.
      if (type === "image") {
        console.error(`[ingestion] vision call failed for source ${source.id}:`, error)
        throw new IngestionError(INGESTION_MESSAGES.imageVisionFailed)
      }
      // Every other format: bytes downloaded fine and matched the signature,
      // so the parser rejecting them means the file's internal structure is
      // genuinely broken or encrypted.
      throw new IngestionError(messages.corrupt)
    }

    if (extracted.text.trim().length === 0) {
      throw new IngestionError(messages.empty)
    }

    return { contentText: extracted.text, pageOffsets: extracted.pageOffsets ?? [] }
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

    // Applies to every file-backed type, not just PDF: `pending` for any
    // uploaded file means "row created, waiting on the client's
    // direct-to-Storage upload to finish". Gating this on `pdf` meant a
    // stale-pending .docx or image whose upload never completed was
    // re-enqueued into a job that could only fail the same way again.
    if (stalePending && isFileSourceType(source.type)) {
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

    // Same orphan risk as the create-time enqueue calls (see
    // `enqueueOrMarkFailed`'s doc comment) — a retry's enqueue can fail too,
    // and the row was just reset to `pending` above.
    await this.enqueueOrMarkFailed(data.sourceId)

    return updated
  }

  /**
   * Signed read URL for an image source's Storage object, for the reader.
   *
   * Ownership is enforced twice on purpose. `getOwnedSource` rejects a
   * source id belonging to somebody else before any URL is minted, and the
   * client this runs on is the request-scoped (RLS-scoped) one, so the
   * bucket's own `(storage.foldername(name))[1] = auth.uid()::text` policy
   * has to agree as well. Either check alone would be sufficient; both means
   * a mistake in one does not silently expose another user's image.
   *
   * The URL is deliberately short-lived: it is generated per reader open and
   * only has to survive loading the image, so a leaked one expires quickly.
   */
  async createSourceImageUrl(data: {
    sourceId: string
    userId: string
  }): Promise<string> {
    const source = await this.getOwnedSource(data.sourceId, data.userId)

    if (source.type !== "image" || !source.storage_path) {
      throw new SourceNotFoundError()
    }

    return this.deps.createSignedUrl(source.storage_path, SIGNED_URL_TTL_SECONDS)
  }

  /**
   * Returns the deleted source's `notebook_id` (Part A of the empty-chat-
   * summary feature) so the caller (`deleteSourceAction`) can invalidate
   * that notebook's cached summary without a second lookup — the row is
   * gone by the time this returns, so `source.notebook_id` read here is the
   * only place that id is still available.
   */
  async deleteSource(data: {
    sourceId: string
    userId: string
  }): Promise<{ notebookId: string }> {
    const source = await this.getOwnedSource(data.sourceId, data.userId)

    const { error } = await this.client.from("sources").delete().eq("id", data.sourceId)
    if (error) throw error

    // Gate on the presence of a storage object, not on the type. The old
    // `source.type === "pdf" &&` condition meant deleting a .docx, .xlsx or
    // image source removed the row but orphaned its file in Storage
    // forever — a leak that grew with every non-PDF source ever deleted.
    // `storage_path` is null for `text`/`web` sources anyway, so the type
    // check was never what made this safe.
    //
    // Best-effort, same as `deleteStorageObjects` below (Bugfix Befund 3):
    // the `sources` row is already gone by this point, so a Storage failure
    // here can no longer roll anything back — it can only turn an
    // already-successful delete into a reported failure, skipping the
    // caller's `invalidateNotebookSummary`/`revalidatePath` for a delete the
    // user actually got. An orphaned Storage object is harmless (nothing
    // points at it anymore); a `sources` row pointing at an already-deleted
    // file would not be, which is why the DB-delete-then-Storage-delete
    // ORDER stays unchanged — only the failure handling does not.
    if (source.storage_path) {
      try {
        await this.deps.deleteStorageFile(source.storage_path)
      } catch (err) {
        console.error(`[ingestion] failed to delete storage object ${source.storage_path}:`, err)
      }
    }

    return { notebookId: source.notebook_id }
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
  async getNotebookStoragePaths(data: {
    notebookId: string
    userId: string
  }): Promise<string[]> {
    void data.userId

    // The `.eq("type", "pdf")` filter that used to sit here leaked the
    // Storage object of every non-PDF source in a deleted notebook: the row
    // was cascade-deleted with the notebook, but its file was never swept
    // because the sweep only ever looked at PDFs. Selecting on
    // "has a storage_path" is both correct and self-maintaining — a future
    // format needs no change here.
    const { data: rows, error } = await this.client
      .from("sources")
      .select("storage_path")
      .eq("notebook_id", data.notebookId)
      .not("storage_path", "is", null)

    if (error) throw error

    return (rows ?? [])
      .map((row) => row.storage_path)
      .filter((path): path is string => Boolean(path))
  }

  /**
   * Best-effort Storage cleanup for a list of already-known paths (see
   * `getNotebookStoragePaths` above) — call this AFTER the DB delete has
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

  /** Task 5/6 shared lookup: the one existing source (if any) in `notebookId`
   *  that already carries `contentHash` — used both by
   *  `createPendingPdfSource`'s pre-check and by `reconcileContentHash`'s
   *  post-download check to name the conflicting source in
   *  `DuplicateSourceError`. At most one match can ever exist once
   *  `sources_notebook_id_content_hash_key` holds. */
  private async findDuplicateByHash(
    notebookId: string,
    contentHash: string
  ): Promise<{ title: string } | null> {
    const { data, error } = await this.client
      .from("sources")
      .select("title")
      .eq("notebook_id", notebookId)
      .eq("content_hash", contentHash)
      .maybeSingle()

    if (error) throw error
    return data
  }

  /**
   * Recomputes the source's content hash from what the worker actually saw
   * and persists it if it differs from whatever was stored at create time.
   * The worker's value always wins, per the project's "never trust client
   * input" rule.
   *
   * `basis` differs by type, and that is the point of accepting a union:
   *  - file sources pass the downloaded BYTES (the client hashed them
   *    before a direct-to-Storage upload the server never observed);
   *  - `web`/`text` sources pass the extracted TEXT, because there is no
   *    file to hash — and for `web` the text is only known here, after the
   *    fetch, which is why those sources cannot be deduped at create time
   *    the way files and pasted text can.
   *
   * A hash that collides with ANOTHER source in the same notebook hits
   * `sources_notebook_id_content_hash_key` here rather than on insert. That
   * unique-violation is converted into the same `DuplicateSourceError` the
   * create-time paths raise, which `runIngestionJob`'s catch-all then
   * persists as a clean `status='error'` + a message naming the existing
   * source — never an unhandled constraint failure surfacing as a crashed
   * job that pgmq would redeliver forever.
   */
  private async reconcileContentHash(
    source: Source,
    basis: Uint8Array | string
  ): Promise<void> {
    const computedHash =
      typeof basis === "string" ? await sha256HexOfText(basis) : await sha256Hex(basis)
    if (computedHash === source.content_hash) return

    const { error } = await this.client
      .from("sources")
      .update({ content_hash: computedHash })
      .eq("id", source.id)

    if (!error) return

    if (isUniqueViolation(error)) {
      const conflict = await this.findDuplicateByHash(source.notebook_id, computedHash)
      throw new DuplicateSourceError(
        conflict?.title ?? null,
        isFileSourceType(source.type) ? "Datei" : "Quelle"
      )
    }

    throw error
  }

  /**
   * Robustness fix: every call site that enqueues a job for an
   * already-`pending` row (`createTextSource`, `createWebSource`,
   * `enqueueIngestionJob`'s PDF-finalize step, and `retrySource`) used to
   * call `deps.enqueueJob` unguarded. If the enqueue itself failed (queue/DB
   * hiccup, not a content problem), the row was left sitting on `pending`
   * with nothing that would ever pick it up — no job was ever queued, so
   * the worker has nothing to dequeue and nothing ever moves it forward.
   * The ONLY thing that ever surfaced this was the client's 10-minute
   * stale-`pending` guard (`source-status.ts`), which is a fallback for a
   * lost/never-delivered job, not meant to be the primary way a same-request
   * failure becomes visible.
   *
   * Marking the row `error` immediately (rather than leaving it `pending`)
   * also has a side benefit: `retrySource`'s guard allows an immediate retry
   * for any `status === 'error'` row unconditionally, so the user can retry
   * right away instead of waiting out the stale-pending window.
   *
   * Best-effort by design: if `updateSource` itself also fails here, that
   * error propagates instead (masking `enqueueFailed` with whatever
   * `updateSource` throws) — acceptable, since a double failure like that is
   * already a bigger DB-availability problem than this method can solve, and
   * the row falls back to the existing stale-pending guard either way.
   */
  private async enqueueOrMarkFailed(sourceId: string): Promise<void> {
    try {
      await this.deps.enqueueJob(sourceId)
    } catch (enqueueError) {
      // The user-facing message is deliberately generic (constraint: no raw
      // errors reach the client), which would otherwise mean the actual
      // cause is lost entirely — log it server-side, same `[ingestion]`
      // prefix as `deleteStorageObjects`'s best-effort catch below.
      console.error(`[ingestion] enqueue failed for source ${sourceId}:`, enqueueError)
      await this.updateSource(sourceId, {
        status: "error",
        error_message: INGESTION_MESSAGES.enqueueFailed,
      })
      throw new IngestionError(INGESTION_MESSAGES.enqueueFailed)
    }
  }
}

/**
 * The extension to give a source's Storage object. Prefers the uploaded
 * file's own extension when it is one this format legitimately covers
 * (`.jpg` vs `.jpeg`, `.md` vs `.markdown`), otherwise falls back to the
 * format's canonical first entry — so a file uploaded without an extension
 * still lands on a well-formed path rather than one ending in a bare dot.
 */
function storageExtension(fileName: string, type: FileSourceType): string {
  const ext = fileExtension(fileName)
  return FILE_FORMATS[type].extensions.includes(ext)
    ? ext
    : FILE_FORMATS[type].extensions[0]
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

  // Gate on "this extraction produced page offsets" rather than on the type
  // being `pdf`: PDF is the only format that yields them today, but the
  // condition that actually matters here is whether there is anything to
  // attribute a page from — a type check would have to be edited again for
  // any future paginated format.
  if (pageOffsets.length > 0) {
    void sourceType
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
