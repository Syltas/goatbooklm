import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeAll, describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import { sha256Hex, sha256HexOfText } from "../hash"
import {
  createIngestionService,
  DuplicateSourceError,
  INGESTION_MESSAGES,
  SourceNotFoundError,
  type IngestionDeps,
  type Source,
} from "../service"

type QueryResult = { data: unknown; error: unknown }
type CallLog = { method: string; args: unknown[] }[]

/**
 * Table-aware chainable mock: `from(table)` gets its own call log and its
 * own FIFO queue of results. Every chain method (`select`/`insert`/... )
 * returns the same chainable object; `.single()`/`.maybeSingle()` and
 * `await`ing the chainable directly both resolve by shifting the next
 * queued result for that table — mirrors the sequential
 * select-then-update-then-select call pattern the service methods make
 * against a single table.
 */
function createMockClient(responsesByTable: Record<string, QueryResult[]>) {
  const callsByTable: Record<string, CallLog> = {}
  const queues: Record<string, QueryResult[]> = {}
  for (const [table, results] of Object.entries(responsesByTable)) {
    queues[table] = [...results]
  }

  function chainableFor(table: string) {
    callsByTable[table] ??= []
    const log = callsByTable[table]

    const nextResult = (): QueryResult => {
      const queue = queues[table] ??= []
      return queue.shift() ?? { data: null, error: null }
    }

    const chainable: Record<string, unknown> = {
      then: (onFulfilled: (v: QueryResult) => unknown, onRejected?: (r: unknown) => unknown) =>
        Promise.resolve(nextResult()).then(onFulfilled, onRejected),
    }

    for (const method of ["select", "insert", "update", "delete", "eq", "not", "order"]) {
      chainable[method] = vi.fn((...args: unknown[]) => {
        log.push({ method, args })
        return chainable
      })
    }
    for (const method of ["single", "maybeSingle"]) {
      chainable[method] = vi.fn((...args: unknown[]) => {
        log.push({ method, args })
        return Promise.resolve(nextResult())
      })
    }
    return chainable
  }

  const chainablesByTable: Record<string, ReturnType<typeof chainableFor>> = {}
  const from = vi.fn((table: string) => {
    chainablesByTable[table] ??= chainableFor(table)
    return chainablesByTable[table]
  })

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    callsByTable,
  }
}

/** A `fileExtractors` registry whose every head is an independent spy —
 *  built fresh per test so one test's call counts can't leak into another's. */
function createFileExtractors(): IngestionDeps["fileExtractors"] {
  return {
    pdf: vi.fn(),
    txt: vi.fn(),
    md: vi.fn(),
    docx: vi.fn(),
    xlsx: vi.fn(),
    csv: vi.fn(),
    image: vi.fn(),
  }
}

/**
 * `extractPdfText` is accepted as a convenience override and folded into
 * `fileExtractors.pdf`. The registry refactor replaced the old named
 * `IngestionDeps.extractPdfText` field, but the PDF tests below read far
 * better naming the head they are exercising than reaching into a registry
 * literal at every call site — so the shorthand is kept here, in the test
 * helper, rather than in the production interface.
 */
function createDeps(
  client: SupabaseClient<Database>,
  overrides: Partial<IngestionDeps> & {
    extractPdfText?: IngestionDeps["fileExtractors"]["pdf"]
  } = {}
): IngestionDeps {
  const { extractPdfText, fileExtractors, ...rest } = overrides

  const extractors = fileExtractors ?? createFileExtractors()
  if (extractPdfText) extractors.pdf = extractPdfText

  return {
    supabase: client,
    fileExtractors: extractors,
    assertSafeUrl: vi.fn().mockResolvedValue(undefined),
    fetchWebPage: vi.fn(),
    extractWebText: vi.fn(),
    chunkText: vi.fn(),
    embedChunks: vi.fn(),
    downloadStorageFile: vi.fn(),
    deleteStorageFile: vi.fn(),
    storageFileExists: vi.fn().mockResolvedValue(true),
    createSignedUrl: vi.fn().mockResolvedValue("https://signed.example/img.png"),
    enqueueJob: vi.fn().mockResolvedValue(undefined),
    ...rest,
  }
}

/** A valid minimal PDF byte prefix (magic number `%PDF-`) followed by
 *  arbitrary padding — used by tests that need `downloadStorageFile` to
 *  return bytes that pass the M3 magic-bytes check. */
function pdfBytes(body = "1.4 rest-of-file"): Uint8Array {
  return new TextEncoder().encode(`%PDF-${body}`)
}

/** The real SHA-256 of `pdfBytes()`'s default bytes — computed once via the
 *  actual `sha256Hex` (not hand-derived/hardcoded) so any test that puts
 *  this on a fixture's `content_hash` deterministically makes
 *  `reconcileContentHash` (task 6) a no-op: "the client-supplied hash
 *  already matches what the worker just downloaded", the common
 *  non-mismatch case. Tests that DO want to exercise a mismatch use a
 *  different literal `content_hash` value instead (see the dedicated tests
 *  in the "content-hash reconciliation" describe block below). */
let PDF_CONTENT_HASH: string

/** Default `content_text` of `makeSource()`, and its hash. A real `text`
 *  source always carries the hash of its own text (`createTextSource`
 *  computes and stores it), so the fixture carries it too — otherwise
 *  `reconcileContentHash` would see a mismatch and issue an extra UPDATE
 *  that production never performs, which the mock's FIFO queue would then
 *  mis-attribute to the next expected query. */
const TEXT_CONTENT = "Ausreichend langer Beispieltext für Tests."
let TEXT_CONTENT_HASH: string

beforeAll(async () => {
  PDF_CONTENT_HASH = await sha256Hex(pdfBytes())
  TEXT_CONTENT_HASH = await sha256HexOfText(TEXT_CONTENT)
})

const USER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999"
const NOTEBOOK_ID = "22222222-2222-4222-8222-222222222222"
const SOURCE_ID = "33333333-3333-4333-8333-333333333333"
const NOW = new Date().toISOString()

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: SOURCE_ID,
    notebook_id: NOTEBOOK_ID,
    user_id: USER_ID,
    type: "text",
    title: "Testquelle",
    url: null,
    storage_path: null,
    content_text: TEXT_CONTENT,
    content_hash: TEXT_CONTENT_HASH,
    status: "pending",
    error_message: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as Source
}

const DB_ERROR = { message: "connection refused", code: "ECONNREFUSED" }

describe("createIngestionService", () => {
  describe("createTextSource", () => {
    it("happy path: inserts a pending text source and enqueues a job", async () => {
      const row = makeSource()
      const { client, from } = createMockClient({
        sources: [
          { data: null, error: null }, // dedupe pre-check: no existing match
          { data: row, error: null }, // insert + select
        ],
      })
      const enqueueJob = vi.fn().mockResolvedValue(undefined)
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      const result = await service.createTextSource({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        title: "Testquelle",
        text: "Hallo Welt",
      })

      expect(result).toEqual(row)
      expect(from).toHaveBeenCalledWith("sources")
      expect(enqueueJob).toHaveBeenCalledWith(SOURCE_ID)
    })

    it("error path: throws the Supabase error and does not enqueue", async () => {
      const { client } = createMockClient({
        sources: [
          { data: null, error: null }, // dedupe pre-check: no existing match
          { data: null, error: DB_ERROR }, // insert fails
        ],
      })
      const enqueueJob = vi.fn()
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      await expect(
        service.createTextSource({
          notebookId: NOTEBOOK_ID,
          userId: USER_ID,
          title: "X",
          text: "Y",
        })
      ).rejects.toEqual(DB_ERROR)
      expect(enqueueJob).not.toHaveBeenCalled()
    })
  })

  describe("createWebSource", () => {
    it("happy path: pre-checks the URL, falls back to hostname as title, enqueues a job", async () => {
      const row = makeSource({
        type: "web",
        url: "https://example.com/article",
        title: "example.com",
        content_text: null,
      })
      const { client } = createMockClient({ sources: [{ data: row, error: null }] })
      const assertSafeUrl = vi.fn().mockResolvedValue(undefined)
      const enqueueJob = vi.fn().mockResolvedValue(undefined)
      const service = createIngestionService(
        createDeps(client, { assertSafeUrl, enqueueJob })
      )

      const result = await service.createWebSource({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        url: "https://example.com/article",
      })

      expect(assertSafeUrl).toHaveBeenCalledWith("https://example.com/article")
      expect(result).toEqual(row)
      expect(enqueueJob).toHaveBeenCalledWith(SOURCE_ID)
    })

    it("SSRF pre-check failure: no row is created, no job enqueued", async () => {
      const { client, from } = createMockClient({ sources: [] })
      const assertSafeUrl = vi
        .fn()
        .mockRejectedValue(new Error(INGESTION_MESSAGES.ssrfBlocked))
      const enqueueJob = vi.fn()
      const service = createIngestionService(
        createDeps(client, { assertSafeUrl, enqueueJob })
      )

      await expect(
        service.createWebSource({
          notebookId: NOTEBOOK_ID,
          userId: USER_ID,
          url: "http://169.254.169.254/",
        })
      ).rejects.toThrow(INGESTION_MESSAGES.ssrfBlocked)

      expect(from).not.toHaveBeenCalled()
      expect(enqueueJob).not.toHaveBeenCalled()
    })

    // Robustness fix: an enqueue failure AFTER the row already exists used
    // to leave it silently `pending` forever (no job ever reaches the
    // queue, so nothing ever picks it up) — invisible until the client's
    // 10-minute stale-guard finally flagged it. Now the row is marked
    // `error` in the same request, and the action still surfaces a failure
    // to the caller instead of returning a stale "pending"-looking row.
    it("enqueue failure: the row is marked error immediately instead of left pending", async () => {
      const pendingRow = makeSource({
        type: "web",
        url: "https://example.com/article",
        title: "example.com",
        content_text: null,
      })
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: pendingRow, error: null }, // insert().select().single()
          { data: null, error: null }, // enqueueOrMarkFailed's error-marking update
        ],
      })
      const assertSafeUrl = vi.fn().mockResolvedValue(undefined)
      const enqueueJob = vi.fn().mockRejectedValue(new Error("queue unavailable"))
      const service = createIngestionService(
        createDeps(client, { assertSafeUrl, enqueueJob })
      )

      await expect(
        service.createWebSource({
          notebookId: NOTEBOOK_ID,
          userId: USER_ID,
          url: "https://example.com/article",
        })
      ).rejects.toThrow(INGESTION_MESSAGES.enqueueFailed)

      const updateCall = callsByTable.sources.find((c) => c.method === "update")
      expect(updateCall?.args[0]).toMatchObject({
        status: "error",
        error_message: INGESTION_MESSAGES.enqueueFailed,
      })
    })
  })

  // Content-hash dedupe (tasks 5/6) — the create-time half. See the
  // "content-hash reconciliation" describe block (nested under
  // `runIngestionJob` below) for the worker-side half.
  describe("createPendingFileSource", () => {
    const CONTENT_HASH = "a".repeat(64)

    it("happy path: no existing duplicate — inserts with the given content_hash", async () => {
      const row = makeSource({ type: "pdf", content_hash: CONTENT_HASH })
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: null, error: null }, // findDuplicateByHash pre-check: no match
          { data: row, error: null }, // insert().select().single()
        ],
      })
      const service = createIngestionService(createDeps(client))

      const result = await service.createPendingFileSource({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        title: "Testquelle",
        fileName: "test.pdf",
          fileType: "pdf",
        contentHash: CONTENT_HASH,
      })

      // `sourceId`/`storagePath` are generated fresh inside the service
      // (`crypto.randomUUID()`) — not tied to `row.id` (the mock's fixed
      // `SOURCE_ID`), so only the returned shape is asserted here; the
      // actually-inserted row is what matters for the dedupe behavior,
      // asserted below.
      expect(result.sourceId).toBe(row.id)
      expect(result.storagePath).toMatch(new RegExp(`^${USER_ID}/.+\\.pdf$`))
      const insertCall = callsByTable.sources.find((c) => c.method === "insert")
      expect(insertCall?.args[0]).toMatchObject({ content_hash: CONTENT_HASH })
    })

    // The real incident this whole feature responds to (see task brief):
    // two sources in one notebook silently held byte-identical PDFs under
    // different titles. This is the fix — reject before any Storage upload
    // even starts, naming the existing source instead of a generic message.
    it("dedupe hit: an existing source with the same hash in the same notebook is rejected, naming it — no insert attempted", async () => {
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: { title: "Briefing-Legienhof-16.07" }, error: null }, // findDuplicateByHash hit
        ],
      })
      const service = createIngestionService(createDeps(client))

      // Same already-settled promise, checked twice — re-invoking the call
      // would consume a second (unset) queue slot and no longer exercise
      // the dedupe hit at all.
      const call = service.createPendingFileSource({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        title: "Briefing-VZUG-16.07",
        fileName: "vzug.pdf",
          fileType: "pdf",
        contentHash: CONTENT_HASH,
      })
      await expect(call).rejects.toBeInstanceOf(DuplicateSourceError)
      await expect(call).rejects.toThrow("Briefing-Legienhof-16.07")

      expect(callsByTable.sources.some((c) => c.method === "insert")).toBe(false)
    })

    // Task 5's actual point: the pre-check above is a TOCTOU race on its
    // own (two concurrent uploads of the same file both pass the SELECT
    // before either INSERT lands) — the real guarantee is
    // `sources_notebook_id_content_hash_key`. A lost race surfaces here as
    // a 23505 on the INSERT itself, and must still be reported by naming
    // the row that won, not as an unhandled constraint violation.
    it("dedupe race lost on insert (unique_violation): re-queries the winning row and names it", async () => {
      const { client } = createMockClient({
        sources: [
          { data: null, error: null }, // pre-check: no match yet (the race)
          { data: null, error: { code: "23505", message: "duplicate key value" } }, // insert loses the race
          { data: { title: "Wettlauf-Gewinner" }, error: null }, // re-query after the race
        ],
      })
      const service = createIngestionService(createDeps(client))

      await expect(
        service.createPendingFileSource({
          notebookId: NOTEBOOK_ID,
          userId: USER_ID,
          title: "Testquelle",
          fileName: "test.pdf",
          fileType: "pdf",
          contentHash: CONTENT_HASH,
        })
      ).rejects.toThrow("Wettlauf-Gewinner")
    })
  })

  describe("enqueueIngestionJob", () => {
    it("happy path: ownership verified, job enqueued", async () => {
      const row = makeSource({ type: "pdf", status: "pending" })
      const { client } = createMockClient({ sources: [{ data: row, error: null }] })
      const enqueueJob = vi.fn().mockResolvedValue(undefined)
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      await service.enqueueIngestionJob({ sourceId: SOURCE_ID, userId: USER_ID })

      expect(enqueueJob).toHaveBeenCalledWith(SOURCE_ID)
    })

    it("ownership violation: a source owned by another user is rejected, no enqueue", async () => {
      const row = makeSource({ user_id: OTHER_USER_ID })
      const { client } = createMockClient({ sources: [{ data: row, error: null }] })
      const enqueueJob = vi.fn()
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      await expect(
        service.enqueueIngestionJob({ sourceId: SOURCE_ID, userId: USER_ID })
      ).rejects.toThrow(INGESTION_MESSAGES.notFound)
      expect(enqueueJob).not.toHaveBeenCalled()
    })

    it("not found: a nonexistent source is rejected", async () => {
      const { client } = createMockClient({ sources: [{ data: null, error: null }] })
      const service = createIngestionService(createDeps(client))

      await expect(
        service.enqueueIngestionJob({ sourceId: SOURCE_ID, userId: USER_ID })
      ).rejects.toThrow(INGESTION_MESSAGES.notFound)
    })
  })

  describe("runIngestionJob", () => {
    it("happy path (text source): reaches status='ready' with the expected chunk count via stubbed deps", async () => {
      const pendingRow = makeSource({ status: "processing" })
      const readyRow = makeSource({ status: "ready" })
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: pendingRow, error: null }, // getSourceById
          { data: null, error: null }, // updateSource -> processing (no .select(), consumed by `.then`)
          { data: readyRow, error: null }, // final update+select
        ],
        chunks: [{ data: null, error: null }], // insert (no .select())
      })

      const chunks = [
        { index: 0, content: "Chunk A", charStart: 0, charEnd: 7, tokenCount: 2 },
        { index: 1, content: "Chunk B", charStart: 7, charEnd: 14, tokenCount: 2 },
      ]
      const chunkText = vi.fn().mockReturnValue(chunks)
      const embedChunks = vi.fn().mockResolvedValue([
        [0.1, 0.2],
        [0.3, 0.4],
      ])

      const service = createIngestionService(
        createDeps(client, { chunkText, embedChunks })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result).toEqual(readyRow)
      expect(embedChunks).toHaveBeenCalledWith(["Chunk A", "Chunk B"])

      const insertCall = callsByTable.chunks.find((c) => c.method === "insert")
      expect(insertCall).toBeDefined()
      const insertedRows = insertCall!.args[0] as unknown[]
      expect(insertedRows).toHaveLength(chunks.length)
    })

    it("error path: embedChunks throws -> status='error', no chunks inserted", async () => {
      const processingRow = makeSource({ status: "processing" })
      const erroredRow = makeSource({
        status: "error",
        error_message: INGESTION_MESSAGES.embedFailed,
      })
      const { client, from } = createMockClient({
        sources: [
          { data: processingRow, error: null }, // getSourceById
          { data: null, error: null }, // update -> processing
          { data: erroredRow, error: null }, // update -> error (catch block)
        ],
      })

      const chunkText = vi.fn().mockReturnValue([
        { index: 0, content: "x", charStart: 0, charEnd: 1, tokenCount: 1 },
      ])
      const embedChunks = vi.fn().mockRejectedValue(new Error("rate limited"))

      const service = createIngestionService(
        createDeps(client, { chunkText, embedChunks })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(result.error_message).toBe(INGESTION_MESSAGES.embedFailed)
      // "chunks" table was never touched — no insert, no rows.
      expect(from).not.toHaveBeenCalledWith("chunks")
    })

    it("atomic rollback: a failed chunk insert deletes any partially-inserted chunks and sets status='error'", async () => {
      const processingRow = makeSource({ status: "processing" })
      const erroredRow = makeSource({
        status: "error",
        error_message: INGESTION_MESSAGES.persistFailed,
      })
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: processingRow, error: null },
          { data: null, error: null },
          { data: erroredRow, error: null },
        ],
        chunks: [
          { data: null, error: null }, // pre-insert idempotency delete (L2) succeeds
          { data: null, error: DB_ERROR }, // insert fails
          { data: null, error: null }, // rollback delete succeeds
        ],
      })

      const chunkText = vi.fn().mockReturnValue([
        { index: 0, content: "x", charStart: 0, charEnd: 1, tokenCount: 1 },
      ])
      const embedChunks = vi.fn().mockResolvedValue([[0.1]])

      const service = createIngestionService(
        createDeps(client, { chunkText, embedChunks })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(result.error_message).toBe(INGESTION_MESSAGES.persistFailed)

      const chunkMethods = callsByTable.chunks.map((c) => c.method)
      // Three delete/insert-family calls now: the L2 pre-insert delete, the
      // failed insert, and the rollback delete — assert the ROLLBACK delete
      // (the last one) comes after the insert, not just "any delete".
      expect(chunkMethods).toContain("insert")
      expect(chunkMethods.lastIndexOf("delete")).toBeGreaterThan(
        chunkMethods.indexOf("insert")
      )
    })

    it("pdf with empty extracted text: status='error' with the image-PDF message, no chunking attempted", async () => {
      const pdfRow = makeSource({
        type: "pdf",
        storage_path: `${USER_ID}/${SOURCE_ID}.pdf`,
        content_text: null,
        status: "processing",
        // Matches `pdfBytes()`'s real hash — `reconcileContentHash` is a
        // no-op, no extra "sources" call to account for in the mocked queue
        // below (see `PDF_CONTENT_HASH`'s doc comment).
        content_hash: PDF_CONTENT_HASH,
      })
      const erroredRow = makeSource({
        type: "pdf",
        status: "error",
        error_message: INGESTION_MESSAGES.pdfEmpty,
      })
      const { client } = createMockClient({
        sources: [
          { data: pdfRow, error: null },
          { data: null, error: null },
          { data: erroredRow, error: null },
        ],
      })

      const downloadStorageFile = vi.fn().mockResolvedValue(pdfBytes())
      const extractPdfText = vi.fn().mockResolvedValue({ text: "   ", pageOffsets: [] })
      const chunkText = vi.fn()

      const service = createIngestionService(
        createDeps(client, { downloadStorageFile, extractPdfText, chunkText })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(result.error_message).toBe(INGESTION_MESSAGES.pdfEmpty)
      expect(chunkText).not.toHaveBeenCalled()
    })

    // Robustness fix: a download-layer failure (Storage unreachable, network
    // hiccup) used to throw the same `pdfCorrupt` message as an actually
    // broken file — misleading, since nothing about the file's content was
    // ever examined here. Own message (`pdfDownloadFailed`), extraction
    // never attempted.
    it("pdf download failure (storage unreachable): status='error' with the download-failed message, not the corrupt-PDF one", async () => {
      const pdfRow = makeSource({
        type: "pdf",
        storage_path: `${USER_ID}/${SOURCE_ID}.pdf`,
        content_text: null,
        status: "processing",
      })
      const erroredRow = makeSource({
        type: "pdf",
        status: "error",
        error_message: INGESTION_MESSAGES.pdfDownloadFailed,
      })
      const { client } = createMockClient({
        sources: [
          { data: pdfRow, error: null },
          { data: null, error: null },
          { data: erroredRow, error: null },
        ],
      })

      const downloadStorageFile = vi
        .fn()
        .mockRejectedValue(new Error("storage unreachable"))
      const extractPdfText = vi.fn()

      const service = createIngestionService(
        createDeps(client, { downloadStorageFile, extractPdfText })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(result.error_message).toBe(INGESTION_MESSAGES.pdfDownloadFailed)
      expect(extractPdfText).not.toHaveBeenCalled()
    })

    it("pdf extraction throwing (corrupted/encrypted): status='error' with the corrupt-PDF message", async () => {
      const pdfRow = makeSource({
        type: "pdf",
        storage_path: `${USER_ID}/${SOURCE_ID}.pdf`,
        content_text: null,
        status: "processing",
        content_hash: PDF_CONTENT_HASH, // no-op reconcile, see doc comment
      })
      const erroredRow = makeSource({
        type: "pdf",
        status: "error",
        error_message: INGESTION_MESSAGES.pdfCorrupt,
      })
      const { client } = createMockClient({
        sources: [
          { data: pdfRow, error: null },
          { data: null, error: null },
          { data: erroredRow, error: null },
        ],
      })

      const downloadStorageFile = vi.fn().mockResolvedValue(pdfBytes())
      const extractPdfText = vi.fn().mockRejectedValue(new Error("bad PDF"))

      const service = createIngestionService(
        createDeps(client, { downloadStorageFile, extractPdfText })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })
      expect(result.status).toBe("error")
      expect(result.error_message).toBe(INGESTION_MESSAGES.pdfCorrupt)
    })

    it("pdf with bytes that don't start with the PDF magic number: status='error' with the corrupt-PDF message, extraction never attempted (M3)", async () => {
      const pdfRow = makeSource({
        type: "pdf",
        storage_path: `${USER_ID}/${SOURCE_ID}.pdf`,
        content_text: null,
        status: "processing",
      })
      const erroredRow = makeSource({
        type: "pdf",
        status: "error",
        error_message: INGESTION_MESSAGES.pdfCorrupt,
      })
      const { client } = createMockClient({
        sources: [
          { data: pdfRow, error: null },
          { data: null, error: null },
          { data: erroredRow, error: null },
        ],
      })

      // Not a PDF at all — e.g. a renamed .txt/.html file uploaded despite
      // the client-declared `application/pdf` content-type.
      const downloadStorageFile = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode("<html>not a pdf</html>"))
      const extractPdfText = vi.fn()

      const service = createIngestionService(
        createDeps(client, { downloadStorageFile, extractPdfText })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(result.error_message).toBe(INGESTION_MESSAGES.pdfCorrupt)
      expect(extractPdfText).not.toHaveBeenCalled()
    })

    it("pdf with fewer than 5 downloaded bytes: rejected as corrupt rather than throwing (M3 edge case)", async () => {
      const pdfRow = makeSource({
        type: "pdf",
        storage_path: `${USER_ID}/${SOURCE_ID}.pdf`,
        content_text: null,
        status: "processing",
      })
      const erroredRow = makeSource({
        type: "pdf",
        status: "error",
        error_message: INGESTION_MESSAGES.pdfCorrupt,
      })
      const { client } = createMockClient({
        sources: [
          { data: pdfRow, error: null },
          { data: null, error: null },
          { data: erroredRow, error: null },
        ],
      })

      const downloadStorageFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2]))
      const extractPdfText = vi.fn()

      const service = createIngestionService(
        createDeps(client, { downloadStorageFile, extractPdfText })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(result.error_message).toBe(INGESTION_MESSAGES.pdfCorrupt)
      expect(extractPdfText).not.toHaveBeenCalled()
    })

    it("source not found: throws SourceNotFoundError without touching sources further (M1)", async () => {
      const { client } = createMockClient({ sources: [{ data: null, error: null }] })
      const service = createIngestionService(createDeps(client))

      await expect(
        service.runIngestionJob({ sourceId: SOURCE_ID })
      ).rejects.toThrow(INGESTION_MESSAGES.notFound)

      await expect(
        service.runIngestionJob({ sourceId: SOURCE_ID })
      ).rejects.toBeInstanceOf(SourceNotFoundError)
    })

    it("idempotent re-run: a second full run against the same source replaces its chunks rather than duplicating them (L2)", async () => {
      const processingRow = makeSource({ status: "processing" })
      const readyRow = makeSource({ status: "ready" })
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: processingRow, error: null }, // getSourceById
          { data: null, error: null }, // update -> processing
          { data: readyRow, error: null }, // final update+select
        ],
        chunks: [{ data: null, error: null }], // insert (no .select())
      })

      const chunks = [
        { index: 0, content: "Chunk A", charStart: 0, charEnd: 7, tokenCount: 2 },
      ]
      const chunkText = vi.fn().mockReturnValue(chunks)
      const embedChunks = vi.fn().mockResolvedValue([[0.1, 0.2]])

      const service = createIngestionService(
        createDeps(client, { chunkText, embedChunks })
      )

      await service.runIngestionJob({ sourceId: SOURCE_ID })

      const chunkMethods = callsByTable.chunks.map((c) => c.method)
      expect(chunkMethods).toEqual(["delete", "eq", "insert"])
      const deleteCall = callsByTable.chunks.find((c) => c.method === "delete")
      expect(deleteCall?.args).toEqual([])
      // The `.eq("source_id", ...)` call that scopes the delete:
      const eqCall = callsByTable.chunks.find((c) => c.method === "eq")
      expect(eqCall?.args).toEqual(["source_id", SOURCE_ID])
    })

    it("pdf page-boundary metadata: a chunk starting inside the inter-page separator is attributed to the preceding page (L4)", async () => {
      const pdfRow = makeSource({
        type: "pdf",
        storage_path: `${USER_ID}/${SOURCE_ID}.pdf`,
        content_text: null,
        status: "processing",
        content_hash: PDF_CONTENT_HASH, // no-op reconcile, see doc comment
      })
      const readyRow = makeSource({ type: "pdf", status: "ready" })
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: pdfRow, error: null },
          { data: null, error: null },
          { data: readyRow, error: null },
        ],
        chunks: [{ data: null, error: null }],
      })

      // "Erste Seite." (12 chars, page 1: [0,12)) + "\n\n" (separator,
      // [12,14) — belongs to NEITHER pageOffsets entry) + "Zweite Seite."
      // (page 2: [14,27)). A chunk starting at charStart=13 lands inside
      // that separator gap.
      const downloadStorageFile = vi.fn().mockResolvedValue(pdfBytes())
      const extractPdfText = vi.fn().mockResolvedValue({
        text: "Erste Seite.\n\nZweite Seite.",
        pageOffsets: [
          { page: 1, charStart: 0, charEnd: 12 },
          { page: 2, charStart: 14, charEnd: 27 },
        ],
      })
      const chunkText = vi.fn().mockReturnValue([
        { index: 0, content: "\nZweite", charStart: 13, charEnd: 20, tokenCount: 2 },
      ])
      const embedChunks = vi.fn().mockResolvedValue([[0.1]])

      const service = createIngestionService(
        createDeps(client, {
          downloadStorageFile,
          extractPdfText,
          chunkText,
          embedChunks,
        })
      )

      await service.runIngestionJob({ sourceId: SOURCE_ID })

      const insertCall = callsByTable.chunks.find((c) => c.method === "insert")
      const insertedRows = insertCall!.args[0] as { metadata: { page?: number } }[]
      expect(insertedRows[0].metadata.page).toBe(1)
    })

    // Task 6: the worker re-hashes the PDF bytes it actually downloaded and
    // never trusts the client-supplied `content_hash` at face value — the
    // client hashes before a direct-to-Storage upload the server never
    // observes, only weakly trustworthy per the project's "never trust
    // client input" rule.
    describe("content-hash reconciliation", () => {
      it("worker hash differs from the client-supplied one: the worker's value wins and is persisted, pipeline continues to ready", async () => {
        const pdfRow = makeSource({
          type: "pdf",
          storage_path: `${USER_ID}/${SOURCE_ID}.pdf`,
          content_text: null,
          status: "processing",
          // Deliberately NOT `PDF_CONTENT_HASH` — simulates a client-supplied
          // hash that doesn't match the bytes actually in Storage.
          content_hash: "0".repeat(64),
        })
        const readyRow = makeSource({ type: "pdf", status: "ready" })
        const { client, callsByTable } = createMockClient({
          sources: [
            { data: pdfRow, error: null }, // getSourceById
            { data: null, error: null }, // updateSource -> processing
            { data: null, error: null }, // reconcileContentHash's update — succeeds
            { data: readyRow, error: null }, // final update+select
          ],
          chunks: [{ data: null, error: null }],
        })

        const downloadStorageFile = vi.fn().mockResolvedValue(pdfBytes())
        const extractPdfText = vi
          .fn()
          .mockResolvedValue({ text: "Ausreichend langer Text.", pageOffsets: [] })
        const chunkText = vi.fn().mockReturnValue([
          { index: 0, content: "Ausreichend langer Text.", charStart: 0, charEnd: 24, tokenCount: 5 },
        ])
        const embedChunks = vi.fn().mockResolvedValue([[0.1, 0.2]])

        const service = createIngestionService(
          createDeps(client, { downloadStorageFile, extractPdfText, chunkText, embedChunks })
        )

        const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

        expect(result.status).toBe("ready")

        const hashUpdateCall = callsByTable.sources
          .filter((c) => c.method === "update")
          .find(
            (c) =>
              typeof c.args[0] === "object" &&
              c.args[0] !== null &&
              "content_hash" in (c.args[0] as object)
          )
        expect(hashUpdateCall?.args[0]).toEqual({ content_hash: PDF_CONTENT_HASH })
      })

      // Task 6's explicit edge case: "was passiert, wenn der Worker-Hash ein
      // Duplikat ergibt, das die Client-Prüfung nicht gesehen hat" — the
      // `unique(notebook_id, content_hash)` constraint rejects the
      // reconcile update, and that must become a clean `status='error'`
      // naming the conflicting source, not an unhandled constraint failure.
      it("worker hash collides with another source (unique_violation): status='error' naming the conflicting source, extraction never attempted", async () => {
        const pdfRow = makeSource({
          type: "pdf",
          storage_path: `${USER_ID}/${SOURCE_ID}.pdf`,
          content_text: null,
          status: "processing",
          content_hash: "0".repeat(64),
        })
        const erroredRow = makeSource({
          type: "pdf",
          status: "error",
          error_message: "Diese Datei ist identisch mit „Bestehende Quelle“.",
        })
        const { client } = createMockClient({
          sources: [
            { data: pdfRow, error: null }, // getSourceById
            { data: null, error: null }, // updateSource -> processing
            { data: null, error: { code: "23505", message: "duplicate key value" } }, // reconcile update loses the race
            { data: { title: "Bestehende Quelle" }, error: null }, // findDuplicateByHash re-query
            { data: erroredRow, error: null }, // final catch-all update+select
          ],
        })

        const downloadStorageFile = vi.fn().mockResolvedValue(pdfBytes())
        const extractPdfText = vi.fn()

        const service = createIngestionService(
          createDeps(client, { downloadStorageFile, extractPdfText })
        )

        const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

        expect(result.status).toBe("error")
        expect(result.error_message).toContain("Bestehende Quelle")
        expect(extractPdfText).not.toHaveBeenCalled()
      })
    })
  })

  describe("retrySource", () => {
    it("guard: a source currently processing (not stale) is rejected", async () => {
      const processingRow = makeSource({
        status: "processing",
        updated_at: new Date().toISOString(),
      })
      const { client } = createMockClient({ sources: [{ data: processingRow, error: null }] })
      const enqueueJob = vi.fn()
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      await expect(
        service.retrySource({ sourceId: SOURCE_ID, userId: USER_ID })
      ).rejects.toThrow(INGESTION_MESSAGES.processingInProgress)
      expect(enqueueJob).not.toHaveBeenCalled()
    })

    it("exception: a stale processing source (>10min) is allowed to retry", async () => {
      const staleUpdatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString()
      const staleRow = makeSource({ status: "processing", updated_at: staleUpdatedAt })
      const pendingAgain = makeSource({ status: "pending", error_message: null })
      const { client } = createMockClient({
        sources: [
          { data: staleRow, error: null },
          { data: pendingAgain, error: null },
        ],
      })
      const enqueueJob = vi.fn().mockResolvedValue(undefined)
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      const result = await service.retrySource({ sourceId: SOURCE_ID, userId: USER_ID })

      expect(result.status).toBe("pending")
      expect(enqueueJob).toHaveBeenCalledWith(SOURCE_ID)
    })

    it("happy path: an error source is reset to pending and re-enqueued", async () => {
      const erroredRow = makeSource({ status: "error", error_message: "irgendein Fehler" })
      const pendingAgain = makeSource({ status: "pending", error_message: null })
      const { client } = createMockClient({
        sources: [
          { data: erroredRow, error: null },
          { data: pendingAgain, error: null },
        ],
      })
      const enqueueJob = vi.fn().mockResolvedValue(undefined)
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      const result = await service.retrySource({ sourceId: SOURCE_ID, userId: USER_ID })

      expect(result.status).toBe("pending")
      expect(result.error_message).toBeNull()
      expect(enqueueJob).toHaveBeenCalledWith(SOURCE_ID)
    })

    it("ownership violation: rejected before touching status", async () => {
      const foreignRow = makeSource({ status: "error", user_id: OTHER_USER_ID })
      const { client } = createMockClient({ sources: [{ data: foreignRow, error: null }] })
      const enqueueJob = vi.fn()
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      await expect(
        service.retrySource({ sourceId: SOURCE_ID, userId: USER_ID })
      ).rejects.toThrow(INGESTION_MESSAGES.notFound)
      expect(enqueueJob).not.toHaveBeenCalled()
    })

    // Eng-Review M2 — stale-pending recovery.
    const STALE_PENDING_AT = new Date(Date.now() - 11 * 60 * 1000).toISOString()

    it("stale pending (>10min), non-pdf: allowed to retry without any storage check", async () => {
      const staleRow = makeSource({
        type: "text",
        status: "pending",
        updated_at: STALE_PENDING_AT,
      })
      const pendingAgain = makeSource({ type: "text", status: "pending", error_message: null })
      const { client } = createMockClient({
        sources: [
          { data: staleRow, error: null },
          { data: pendingAgain, error: null },
        ],
      })
      const enqueueJob = vi.fn().mockResolvedValue(undefined)
      const storageFileExists = vi.fn()
      const service = createIngestionService(
        createDeps(client, { enqueueJob, storageFileExists })
      )

      const result = await service.retrySource({ sourceId: SOURCE_ID, userId: USER_ID })

      expect(result.status).toBe("pending")
      expect(enqueueJob).toHaveBeenCalledWith(SOURCE_ID)
      expect(storageFileExists).not.toHaveBeenCalled()
    })

    it("stale pending (>10min), pdf whose upload actually finished: allowed to retry", async () => {
      const storagePath = `${USER_ID}/${SOURCE_ID}.pdf`
      const staleRow = makeSource({
        type: "pdf",
        storage_path: storagePath,
        status: "pending",
        updated_at: STALE_PENDING_AT,
      })
      const pendingAgain = makeSource({
        type: "pdf",
        storage_path: storagePath,
        status: "pending",
        error_message: null,
      })
      const { client } = createMockClient({
        sources: [
          { data: staleRow, error: null },
          { data: pendingAgain, error: null },
        ],
      })
      const enqueueJob = vi.fn().mockResolvedValue(undefined)
      const storageFileExists = vi.fn().mockResolvedValue(true)
      const service = createIngestionService(
        createDeps(client, { enqueueJob, storageFileExists })
      )

      const result = await service.retrySource({ sourceId: SOURCE_ID, userId: USER_ID })

      expect(storageFileExists).toHaveBeenCalledWith(storagePath)
      expect(result.status).toBe("pending")
      expect(enqueueJob).toHaveBeenCalledWith(SOURCE_ID)
    })

    it("stale pending (>10min), pdf whose upload never finished: rejected with the re-upload message, never enqueued", async () => {
      const storagePath = `${USER_ID}/${SOURCE_ID}.pdf`
      const staleRow = makeSource({
        type: "pdf",
        storage_path: storagePath,
        status: "pending",
        updated_at: STALE_PENDING_AT,
      })
      const { client } = createMockClient({ sources: [{ data: staleRow, error: null }] })
      const enqueueJob = vi.fn()
      const storageFileExists = vi.fn().mockResolvedValue(false)
      const service = createIngestionService(
        createDeps(client, { enqueueJob, storageFileExists })
      )

      await expect(
        service.retrySource({ sourceId: SOURCE_ID, userId: USER_ID })
      ).rejects.toThrow(INGESTION_MESSAGES.stalePendingNoUpload)

      expect(storageFileExists).toHaveBeenCalledWith(storagePath)
      expect(enqueueJob).not.toHaveBeenCalled()
    })

    it("pending, NOT yet stale: still rejected (unchanged base guard)", async () => {
      const freshPendingRow = makeSource({
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      const { client } = createMockClient({ sources: [{ data: freshPendingRow, error: null }] })
      const enqueueJob = vi.fn()
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      await expect(
        service.retrySource({ sourceId: SOURCE_ID, userId: USER_ID })
      ).rejects.toThrow(INGESTION_MESSAGES.processingInProgress)
      expect(enqueueJob).not.toHaveBeenCalled()
    })
  })

  /**
   * The error message the service actually WROTE. The mock returns whatever
   * row was queued for the final select, so asserting on `result.error_message`
   * would only re-read the fixture; the update payload is the real output.
   */
  function writtenErrorMessage(
    callsByTable: Record<string, { method: string; args: unknown[] }[]>
  ): string | undefined {
    return callsByTable.sources
      .filter((c) => c.method === "update")
      .map((c) => c.args[0] as { status?: string; error_message?: string })
      .find((payload) => payload.status === "error")?.error_message
  }

  /**
   * The generalized file branch. Every one of these used to be PDF-only:
   * the size check, the magic-byte check, and the extraction head itself.
   */
  describe("multi-format file extraction", () => {
    const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

    function fileSourceMocks(row: Source) {
      return createMockClient({
        sources: [
          { data: row, error: null }, // getSourceById
          { data: null, error: null }, // updateSource -> processing
          { data: makeSource({ ...row, status: "error" }), error: null }, // catch-all
        ],
      })
    }

    it("routes each source type to its own extraction head, never to PDF's", async () => {
      const docxRow = makeSource({
        type: "docx",
        storage_path: `${USER_ID}/${SOURCE_ID}.docx`,
        content_hash: null,
        status: "processing",
      })
      const { client } = createMockClient({
        sources: [
          { data: docxRow, error: null },
          { data: null, error: null }, // -> processing
          { data: null, error: null }, // reconcileContentHash
          { data: makeSource({ type: "docx", status: "ready" }), error: null },
        ],
        chunks: [{ data: null, error: null }],
      })

      const fileExtractors = createFileExtractors()
      fileExtractors.docx = vi.fn().mockResolvedValue({ text: "Word-Inhalt." })

      const service = createIngestionService(
        createDeps(client, {
          fileExtractors,
          downloadStorageFile: vi.fn().mockResolvedValue(new Uint8Array(ZIP_MAGIC)),
          chunkText: vi
            .fn()
            .mockReturnValue([
              { index: 0, content: "Word-Inhalt.", charStart: 0, charEnd: 12, tokenCount: 3 },
            ]),
          embedChunks: vi.fn().mockResolvedValue([[0.1]]),
        })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("ready")
      expect(fileExtractors.docx).toHaveBeenCalledOnce()
      expect(fileExtractors.pdf).not.toHaveBeenCalled()
    })

    it("rejects bytes whose signature does not match the claimed format", async () => {
      const docxRow = makeSource({
        type: "docx",
        storage_path: `${USER_ID}/${SOURCE_ID}.docx`,
        status: "processing",
      })
      const { client, callsByTable } = fileSourceMocks(docxRow)

      const fileExtractors = createFileExtractors()
      const service = createIngestionService(
        createDeps(client, {
          fileExtractors,
          // A PDF renamed to .docx — the bucket's MIME allowlist cannot
          // catch this (the client declares the content type), only the
          // bytes can.
          downloadStorageFile: vi.fn().mockResolvedValue(pdfBytes()),
        })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(writtenErrorMessage(callsByTable)).toBe(INGESTION_MESSAGES.docxCorrupt)
      expect(fileExtractors.docx).not.toHaveBeenCalled()
    })

    it("enforces the per-format size cap on the real bytes, not one shared constant", async () => {
      // 6 MB of PNG: under the PDF cap (20 MB) that used to be the only
      // check, over the image cap (5 MB) that actually applies.
      const oversized = new Uint8Array(6 * 1024 * 1024)
      oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)

      const imageRow = makeSource({
        type: "image",
        storage_path: `${USER_ID}/${SOURCE_ID}.png`,
        content_hash: null,
        status: "processing",
      })
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: imageRow, error: null },
          { data: null, error: null }, // -> processing
          { data: null, error: null }, // reconcileContentHash
          { data: makeSource({ type: "image", status: "error" }), error: null },
        ],
      })

      const fileExtractors = createFileExtractors()
      const service = createIngestionService(
        createDeps(client, {
          fileExtractors,
          downloadStorageFile: vi.fn().mockResolvedValue(oversized),
        })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(writtenErrorMessage(callsByTable)).toBe(INGESTION_MESSAGES.sizeLimitExceeded)
      expect(fileExtractors.image).not.toHaveBeenCalled()
    })

    it("reports a failed vision call as retryable, not as a broken image", async () => {
      // The bytes passed the magic check, so the file is fine — it was the
      // model call that failed. Saying "Bild ist ungültig" would send the
      // user off to fix a file that has nothing wrong with it.
      const imageRow = makeSource({
        type: "image",
        storage_path: `${USER_ID}/${SOURCE_ID}.png`,
        content_hash: null,
        status: "processing",
      })
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: imageRow, error: null },
          { data: null, error: null },
          { data: null, error: null }, // reconcileContentHash
          { data: makeSource({ type: "image", status: "error" }), error: null },
        ],
      })

      const fileExtractors = createFileExtractors()
      fileExtractors.image = vi.fn().mockRejectedValue(new Error("429 rate limited"))

      const service = createIngestionService(
        createDeps(client, {
          fileExtractors,
          downloadStorageFile: vi
            .fn()
            .mockResolvedValue(
              new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            ),
        })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(writtenErrorMessage(callsByTable)).toBe(INGESTION_MESSAGES.imageVisionFailed)
      expect(writtenErrorMessage(callsByTable)).not.toBe(INGESTION_MESSAGES.imageCorrupt)
    })

    it("gives each format its own empty-result message", async () => {
      const xlsxRow = makeSource({
        type: "xlsx",
        storage_path: `${USER_ID}/${SOURCE_ID}.xlsx`,
        content_hash: null,
        status: "processing",
      })
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: xlsxRow, error: null },
          { data: null, error: null },
          { data: null, error: null }, // reconcileContentHash
          { data: makeSource({ type: "xlsx", status: "error" }), error: null },
        ],
      })

      const fileExtractors = createFileExtractors()
      fileExtractors.xlsx = vi.fn().mockResolvedValue({ text: "   " })

      const service = createIngestionService(
        createDeps(client, {
          fileExtractors,
          downloadStorageFile: vi.fn().mockResolvedValue(new Uint8Array(ZIP_MAGIC)),
        })
      )

      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      // Not the PDF wording — an empty spreadsheet has nothing to do with
      // scanned pages or OCR.
      void result
      expect(writtenErrorMessage(callsByTable)).toBe(INGESTION_MESSAGES.xlsxEmpty)
      expect(writtenErrorMessage(callsByTable)).not.toBe(INGESTION_MESSAGES.pdfEmpty)
    })

    it("createPendingFileSource puts the real extension on the storage path", async () => {
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: null, error: null }, // dedupe pre-check
          { data: makeSource({ type: "image" }), error: null }, // insert
        ],
      })
      const service = createIngestionService(createDeps(client))

      const { storagePath } = await service.createPendingFileSource({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        title: "Foto",
        fileName: "Foto.JPG",
        fileType: "image",
        contentHash: PDF_CONTENT_HASH,
      })

      // Not `.pdf` (the old hard-coded suffix) — Storage serves by
      // extension, so an image under a .pdf path gets the wrong content type.
      expect(storagePath).toMatch(/\.jpg$/)
      expect(storagePath.startsWith(`${USER_ID}/`)).toBe(true)

      const insertCall = callsByTable.sources.find((c) => c.method === "insert")
      expect((insertCall!.args[0] as { type: string }).type).toBe("image")
    })

    it("falls back to the canonical extension when the upload has none", async () => {
      const { client } = createMockClient({
        sources: [
          { data: null, error: null },
          { data: makeSource({ type: "docx" }), error: null },
        ],
      })
      const service = createIngestionService(createDeps(client))

      const { storagePath } = await service.createPendingFileSource({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        title: "Ohne Endung",
        fileName: "dokument",
        fileType: "docx",
        contentHash: PDF_CONTENT_HASH,
      })

      expect(storagePath).toMatch(/\.docx$/)
    })
  })

  /**
   * Dedupe beyond the PDF path. The unique index
   * `(notebook_id, content_hash)` never fired for `text`/`web` sources
   * because neither ever set `content_hash`, and Postgres treats every NULL
   * in a unique index as distinct — so the same note converted twice, or the
   * same URL added twice, produced two independent sources silently. That is
   * the corpus duplication that halves effective top-k.
   */
  describe("dedupe for non-PDF source types", () => {
    it("createTextSource: rejects identical text up front, naming the existing source", async () => {
      const { client, callsByTable } = createMockClient({
        sources: [
          // Dedupe pre-check finds a row with the same content hash.
          { data: { title: "Briefing-Legienhof" }, error: null },
        ],
      })
      const enqueueJob = vi.fn()
      const service = createIngestionService(createDeps(client, { enqueueJob }))

      const call = service.createTextSource({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        title: "Andere Überschrift, gleicher Text",
        text: "Exakt derselbe Notiztext.",
      })

      await expect(call).rejects.toBeInstanceOf(DuplicateSourceError)
      // Naming the existing source is the whole point — a generic "already
      // exists" would not have surfaced the real incident, where two sources
      // held the same document under two different titles.
      await expect(call).rejects.toThrow("Briefing-Legienhof")

      // Rejected before any row is written or job queued.
      expect(callsByTable.sources.some((c) => c.method === "insert")).toBe(false)
      expect(enqueueJob).not.toHaveBeenCalled()
    })

    it("createTextSource: stores the hash of the text so later duplicates can be caught", async () => {
      const row = makeSource()
      const { client, callsByTable } = createMockClient({
        sources: [
          { data: null, error: null }, // pre-check: no match
          { data: row, error: null }, // insert + select
        ],
      })
      const service = createIngestionService(createDeps(client))

      await service.createTextSource({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        title: "Notiz",
        text: TEXT_CONTENT,
      })

      const insertCall = callsByTable.sources.find((c) => c.method === "insert")
      const inserted = insertCall!.args[0] as { content_hash?: string }
      expect(inserted.content_hash).toBe(TEXT_CONTENT_HASH)
    })

    it("createTextSource: a lost insert race still reports the named duplicate", async () => {
      const { client } = createMockClient({
        sources: [
          { data: null, error: null }, // pre-check passes (concurrent writer not yet committed)
          { data: null, error: { code: "23505" } }, // insert hits the unique constraint
          { data: { title: "Wettlauf-Gewinner" }, error: null }, // re-query names it
        ],
      })
      const service = createIngestionService(createDeps(client))

      await expect(
        service.createTextSource({
          notebookId: NOTEBOOK_ID,
          userId: USER_ID,
          title: "Notiz",
          text: "irgendein Text",
        })
      ).rejects.toThrow("Wettlauf-Gewinner")
    })

    it("web source: the worker hashes the EXTRACTED article text, not the HTML", async () => {
      // Hashing the response HTML would never match itself — the markup
      // around an article changes on nearly every fetch (ads, nav, build
      // hashes) while the article does not.
      const articleText = "Der eigentliche Artikeltext, lang genug für Tests."
      const webRow = makeSource({
        type: "web",
        url: "https://example.com/artikel",
        content_text: null,
        content_hash: null,
        status: "processing",
      })
      const readyRow = makeSource({ type: "web", status: "ready" })

      const { client, callsByTable } = createMockClient({
        sources: [
          { data: webRow, error: null }, // getSourceById
          { data: null, error: null }, // updateSource -> processing
          { data: null, error: null }, // reconcileContentHash update
          { data: readyRow, error: null }, // final update+select
        ],
        chunks: [{ data: null, error: null }],
      })

      const service = createIngestionService(
        createDeps(client, {
          fetchWebPage: vi
            .fn()
            .mockResolvedValue({ html: "<html>…</html>", finalUrl: "https://example.com/artikel" }),
          extractWebText: vi.fn().mockReturnValue({ text: articleText }),
          chunkText: vi
            .fn()
            .mockReturnValue([
              { index: 0, content: articleText, charStart: 0, charEnd: articleText.length, tokenCount: 9 },
            ]),
          embedChunks: vi.fn().mockResolvedValue([[0.1, 0.2]]),
        })
      )

      await service.runIngestionJob({ sourceId: SOURCE_ID })

      const hashUpdate = callsByTable.sources
        .filter((c) => c.method === "update")
        .map((c) => c.args[0] as { content_hash?: string })
        .find((payload) => payload.content_hash)

      expect(hashUpdate?.content_hash).toBe(await sha256HexOfText(articleText))
    })

    it("worker: a unique violation becomes a clean error status, not a crashed job", async () => {
      // This is the case that must never surface as an unhandled constraint
      // error: pgmq would redeliver the job forever and the source would sit
      // in `processing` with no explanation. It has to end as status='error'
      // with a message naming the source it duplicates.
      const webRow = makeSource({
        type: "web",
        url: "https://example.com/artikel",
        content_text: null,
        content_hash: null,
        status: "processing",
      })
      const erroredRow = makeSource({
        type: "web",
        status: "error",
        error_message: "Diese Quelle ist identisch mit „Bestehende Quelle“.",
      })

      const { client } = createMockClient({
        sources: [
          { data: webRow, error: null }, // getSourceById
          { data: null, error: null }, // updateSource -> processing
          { data: null, error: { code: "23505" } }, // hash update hits the constraint
          { data: { title: "Bestehende Quelle" }, error: null }, // re-query names the winner
          { data: erroredRow, error: null }, // catch-all persists status='error'
        ],
      })

      const service = createIngestionService(
        createDeps(client, {
          fetchWebPage: vi
            .fn()
            .mockResolvedValue({ html: "<html/>", finalUrl: "https://example.com/artikel" }),
          extractWebText: vi.fn().mockReturnValue({ text: "Doppelter Artikeltext." }),
        })
      )

      // Resolves (does not throw) — `processIngestionTick` treats a resolved
      // call as a handled terminal outcome and deletes the job, which is
      // exactly what should happen for a duplicate.
      const result = await service.runIngestionJob({ sourceId: SOURCE_ID })

      expect(result.status).toBe("error")
      expect(result.error_message).toContain("Bestehende Quelle")
    })
  })

  describe("deleteSource", () => {
    it("happy path (pdf): deletes the row and the storage object", async () => {
      const pdfRow = makeSource({ type: "pdf", storage_path: `${USER_ID}/${SOURCE_ID}.pdf` })
      const { client } = createMockClient({
        sources: [
          { data: pdfRow, error: null },
          { data: null, error: null },
        ],
      })
      const deleteStorageFile = vi.fn().mockResolvedValue(undefined)
      const service = createIngestionService(createDeps(client, { deleteStorageFile }))

      await service.deleteSource({ sourceId: SOURCE_ID, userId: USER_ID })

      expect(deleteStorageFile).toHaveBeenCalledWith(`${USER_ID}/${SOURCE_ID}.pdf`)
    })

    it("happy path (text): deletes the row without touching storage", async () => {
      const textRow = makeSource({ type: "text" })
      const { client } = createMockClient({
        sources: [
          { data: textRow, error: null },
          { data: null, error: null },
        ],
      })
      const deleteStorageFile = vi.fn()
      const service = createIngestionService(createDeps(client, { deleteStorageFile }))

      await service.deleteSource({ sourceId: SOURCE_ID, userId: USER_ID })

      expect(deleteStorageFile).not.toHaveBeenCalled()
    })

    it("ownership violation: rejected, nothing deleted", async () => {
      const foreignRow = makeSource({ user_id: OTHER_USER_ID })
      const { client, callsByTable } = createMockClient({
        sources: [{ data: foreignRow, error: null }],
      })
      const deleteStorageFile = vi.fn()
      const service = createIngestionService(createDeps(client, { deleteStorageFile }))

      await expect(
        service.deleteSource({ sourceId: SOURCE_ID, userId: USER_ID })
      ).rejects.toThrow(INGESTION_MESSAGES.notFound)
      expect(deleteStorageFile).not.toHaveBeenCalled()
      expect(callsByTable.sources.some((c) => c.method === "delete")).toBe(false)
    })

    // Bugfix Befund 3 (adversarial review): the row is already gone by the
    // time Storage is touched, so a Storage failure must not surface as a
    // reported error — that used to skip the caller's
    // `invalidateNotebookSummary`/`revalidatePath` for a delete that, from
    // the DB's perspective, already succeeded.
    it("storage delete failure: best-effort, logged, does not throw — the row is already deleted", async () => {
      const pdfRow = makeSource({ type: "pdf", storage_path: `${USER_ID}/${SOURCE_ID}.pdf` })
      const { client } = createMockClient({
        sources: [
          { data: pdfRow, error: null },
          { data: null, error: null },
        ],
      })
      const deleteStorageFile = vi.fn().mockRejectedValue(new Error("storage unavailable"))
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
      const service = createIngestionService(createDeps(client, { deleteStorageFile }))

      const result = await service.deleteSource({ sourceId: SOURCE_ID, userId: USER_ID })

      expect(result).toEqual({ notebookId: pdfRow.notebook_id })
      expect(deleteStorageFile).toHaveBeenCalledWith(`${USER_ID}/${SOURCE_ID}.pdf`)
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })
  })

  // Eng-Review L1: the old single `deleteNotebookStorageObjects` (read +
  // delete in one call) is split into a read-only step and a
  // delete-only step, called on either side of the notebook's DB delete —
  // see app/(app)/notebooks/actions.ts's `deleteNotebookAction`.
  describe("getNotebookStoragePaths", () => {
    it("happy path: returns every pdf source's storage_path, read-only (no deletes)", async () => {
      const rows = [{ storage_path: "u1/a.pdf" }, { storage_path: "u1/b.pdf" }]
      const { client, callsByTable } = createMockClient({
        sources: [{ data: rows, error: null }],
      })
      const service = createIngestionService(createDeps(client))

      const paths = await service.getNotebookStoragePaths({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
      })

      expect(paths).toEqual(["u1/a.pdf", "u1/b.pdf"])
      expect(callsByTable.sources.some((c) => c.method === "delete")).toBe(false)
    })

    it("filters out null storage_path values", async () => {
      const rows = [{ storage_path: "u1/a.pdf" }, { storage_path: null }]
      const { client } = createMockClient({ sources: [{ data: rows, error: null }] })
      const service = createIngestionService(createDeps(client))

      const paths = await service.getNotebookStoragePaths({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
      })

      expect(paths).toEqual(["u1/a.pdf"])
    })
  })

  describe("deleteStorageObjects", () => {
    it("happy path: removes every given storage object", async () => {
      const { client } = createMockClient({})
      const deleteStorageFile = vi.fn().mockResolvedValue(undefined)
      const service = createIngestionService(createDeps(client, { deleteStorageFile }))

      await service.deleteStorageObjects(["u1/a.pdf", "u1/b.pdf"])

      expect(deleteStorageFile).toHaveBeenCalledTimes(2)
      expect(deleteStorageFile).toHaveBeenCalledWith("u1/a.pdf")
      expect(deleteStorageFile).toHaveBeenCalledWith("u1/b.pdf")
    })

    it("error path: a storage delete failure is logged, best-effort, does not throw/block", async () => {
      const { client } = createMockClient({})
      const deleteStorageFile = vi
        .fn()
        .mockRejectedValueOnce(new Error("storage unavailable"))
        .mockResolvedValueOnce(undefined)
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
      const service = createIngestionService(createDeps(client, { deleteStorageFile }))

      await expect(
        service.deleteStorageObjects(["u1/a.pdf", "u1/b.pdf"])
      ).resolves.toBeUndefined()

      expect(deleteStorageFile).toHaveBeenCalledTimes(2)
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it("empty list: resolves immediately, no calls made", async () => {
      const { client } = createMockClient({})
      const deleteStorageFile = vi.fn()
      const service = createIngestionService(createDeps(client, { deleteStorageFile }))

      await service.deleteStorageObjects([])

      expect(deleteStorageFile).not.toHaveBeenCalled()
    })
  })
})
