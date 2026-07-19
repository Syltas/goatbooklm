import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import {
  createIngestionService,
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

function createDeps(
  client: SupabaseClient<Database>,
  overrides: Partial<IngestionDeps> = {}
): IngestionDeps {
  return {
    supabase: client,
    extractPdfText: vi.fn(),
    assertSafeUrl: vi.fn().mockResolvedValue(undefined),
    fetchWebPage: vi.fn(),
    extractWebText: vi.fn(),
    chunkText: vi.fn(),
    embedChunks: vi.fn(),
    downloadStorageFile: vi.fn(),
    deleteStorageFile: vi.fn(),
    storageFileExists: vi.fn().mockResolvedValue(true),
    enqueueJob: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/** A valid minimal PDF byte prefix (magic number `%PDF-`) followed by
 *  arbitrary padding — used by tests that need `downloadStorageFile` to
 *  return bytes that pass the M3 magic-bytes check. */
function pdfBytes(body = "1.4 rest-of-file"): Uint8Array {
  return new TextEncoder().encode(`%PDF-${body}`)
}

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
    content_text: "Ausreichend langer Beispieltext für Tests.",
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
        sources: [{ data: row, error: null }],
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
        sources: [{ data: null, error: DB_ERROR }],
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

    it("pdf extraction throwing (corrupted/encrypted): status='error' with the corrupt-PDF message", async () => {
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
  })

  // Eng-Review L1: the old single `deleteNotebookStorageObjects` (read +
  // delete in one call) is split into a read-only step and a
  // delete-only step, called on either side of the notebook's DB delete —
  // see app/(app)/notebooks/actions.ts's `deleteNotebookAction`.
  describe("getNotebookPdfStoragePaths", () => {
    it("happy path: returns every pdf source's storage_path, read-only (no deletes)", async () => {
      const rows = [{ storage_path: "u1/a.pdf" }, { storage_path: "u1/b.pdf" }]
      const { client, callsByTable } = createMockClient({
        sources: [{ data: rows, error: null }],
      })
      const service = createIngestionService(createDeps(client))

      const paths = await service.getNotebookPdfStoragePaths({
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

      const paths = await service.getNotebookPdfStoragePaths({
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
