import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import { NO_COVERAGE_MESSAGE } from "../prompt"
import { createChatService, type ChatServiceConfig } from "../service"

type QueryResult = { data: unknown; error: unknown; count?: number | null }
type Message = Database["public"]["Tables"]["messages"]["Row"]

const CONFIG: ChatServiceConfig = { topK: 8, minSimilarity: 0.35, historyWindow: 6 }
const NOTEBOOK_ID = "22222222-2222-4222-8222-222222222222"
const USER_ID = "11111111-1111-4111-8111-111111111111"
const DB_ERROR = { message: "connection refused", code: "ECONNREFUSED" }

/**
 * Minimal stand-in for Supabase's `PostgrestFilterBuilder` — mirrors the
 * pattern in `lib/notebooks/__tests__/service.test.ts`. Every chain method
 * returns the same object, which itself is thenable; awaiting it (whichever
 * method was called last) resolves to the configured `{ data, error,
 * count? }` result.
 */
function createChainable(result: QueryResult) {
  const calls: Record<string, unknown[][]> = {}
  const chainable: Record<string, unknown> = {
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  }

  for (const method of ["select", "insert", "eq", "order", "limit"]) {
    chainable[method] = vi.fn((...args: unknown[]) => {
      calls[method] ??= []
      calls[method].push(args)
      return chainable
    })
  }

  for (const method of ["single", "maybeSingle"]) {
    chainable[method] = vi.fn((...args: unknown[]) => {
      calls[method] ??= []
      calls[method].push(args)
      return Promise.resolve(result)
    })
  }

  return { chainable, calls }
}

function createMockClient(result: QueryResult) {
  const { chainable, calls } = createChainable(result)
  const from = vi.fn(() => chainable)
  const client = { from } as unknown as SupabaseClient<Database>
  return { client, from, calls }
}

function messageRow(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-id",
    notebook_id: NOTEBOOK_ID,
    user_id: USER_ID,
    role: "user",
    content: "content",
    citations: [],
    created_at: "2026-07-19T00:00:00.000Z",
    ...overrides,
  }
}

describe("createChatService", () => {
  describe("assertNotebookOwned", () => {
    it("happy path: returns the row when the notebook is owned (RLS lets it through)", async () => {
      const { client, from, calls } = createMockClient({
        data: { id: NOTEBOOK_ID },
        error: null,
      })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      const result = await service.assertNotebookOwned(NOTEBOOK_ID)

      expect(result).toEqual({ id: NOTEBOOK_ID })
      expect(from).toHaveBeenCalledWith("notebooks")
      expect(calls.eq?.[0]).toEqual(["id", NOTEBOOK_ID])
    })

    it("null when not owned / doesn't exist (RLS returns no row)", async () => {
      const { client } = createMockClient({ data: null, error: null })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.assertNotebookOwned(NOTEBOOK_ID)).resolves.toBeNull()
    })

    it("error path: throws the Supabase error", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.assertNotebookOwned(NOTEBOOK_ID)).rejects.toEqual(DB_ERROR)
    })
  })

  describe("countReadySources", () => {
    it("returns the exact count of ready sources", async () => {
      const { client, from, calls } = createMockClient({ data: [], error: null, count: 3 })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      const result = await service.countReadySources(NOTEBOOK_ID)

      expect(result).toBe(3)
      expect(from).toHaveBeenCalledWith("sources")
      expect(calls.eq).toEqual([
        ["notebook_id", NOTEBOOK_ID],
        ["status", "ready"],
      ])
    })

    it("returns 0 when count comes back null", async () => {
      const { client } = createMockClient({ data: [], error: null, count: null })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.countReadySources(NOTEBOOK_ID)).resolves.toBe(0)
    })

    it("error path: throws the Supabase error", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.countReadySources(NOTEBOOK_ID)).rejects.toEqual(DB_ERROR)
    })
  })

  describe("loadHistory", () => {
    it("queries created_at desc + limit(historyWindow), then returns rows reversed to chronological order", async () => {
      const descRows = [
        { role: "assistant", content: "Antwort 3" },
        { role: "user", content: "Frage 3" },
        { role: "assistant", content: "Antwort 2" },
      ]
      const { client, from, calls } = createMockClient({ data: descRows, error: null })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      const result = await service.loadHistory(NOTEBOOK_ID)

      expect(from).toHaveBeenCalledWith("messages")
      expect(calls.select?.[0]).toEqual(["role, content"])
      expect(calls.eq?.[0]).toEqual(["notebook_id", NOTEBOOK_ID])
      expect(calls.order?.[0]).toEqual(["created_at", { ascending: false }])
      expect(calls.limit?.[0]).toEqual([CONFIG.historyWindow])

      // Reversed: oldest -> newest.
      expect(result).toEqual([
        { role: "assistant", content: "Antwort 2" },
        { role: "user", content: "Frage 3" },
        { role: "assistant", content: "Antwort 3" },
      ])
    })

    it("respects a custom historyWindow from config", async () => {
      const { client, calls } = createMockClient({ data: [], error: null })
      const service = createChatService({
        db: client,
        embed: vi.fn(),
        config: { ...CONFIG, historyWindow: 2 },
      })

      await service.loadHistory(NOTEBOOK_ID)

      expect(calls.limit?.[0]).toEqual([2])
    })

    it("empty history resolves to an empty array", async () => {
      const { client } = createMockClient({ data: null, error: null })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.loadHistory(NOTEBOOK_ID)).resolves.toEqual([])
    })

    it("error path: throws the Supabase error", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.loadHistory(NOTEBOOK_ID)).rejects.toEqual(DB_ERROR)
    })
  })

  describe("embedQuery", () => {
    it("delegates to the injected embed dependency and returns its result", async () => {
      const embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
      const service = createChatService({
        db: {} as unknown as SupabaseClient<Database>,
        embed,
        config: CONFIG,
      })

      const result = await service.embedQuery("Was steht in den Quellen?")

      expect(result).toEqual([0.1, 0.2, 0.3])
      expect(embed).toHaveBeenCalledWith("Was steht in den Quellen?")
    })
  })

  describe("retrieve", () => {
    function createRpcClient(result: QueryResult) {
      const rpc = vi.fn(() => Promise.resolve(result))
      const client = { rpc } as unknown as SupabaseClient<Database>
      return { client, rpc }
    }

    it("calls match_chunks with p_-prefixed params mapped from config + args, and maps rows to RetrievedChunk", async () => {
      const rpcRows = [
        {
          chunk_id: "chunk-1",
          source_id: "source-1",
          content: "Inhalt 1",
          chunk_index: 0,
          similarity: 0.87,
          metadata: { char_start: 0, char_end: 10 },
        },
      ]
      const { client, rpc } = createRpcClient({ data: rpcRows, error: null })
      const service = createChatService({
        db: client,
        embed: vi.fn(),
        config: { topK: 5, minSimilarity: 0.42, historyWindow: 6 },
      })

      const result = await service.retrieve(NOTEBOOK_ID, [0.1, 0.2, 0.3])

      expect(rpc).toHaveBeenCalledWith("match_chunks", {
        p_notebook_id: NOTEBOOK_ID,
        p_query_embedding: "[0.1,0.2,0.3]",
        p_match_count: 5,
        p_min_similarity: 0.42,
      })
      expect(result).toEqual([
        {
          chunkId: "chunk-1",
          sourceId: "source-1",
          content: "Inhalt 1",
          chunkIndex: 0,
          similarity: 0.87,
          metadata: { char_start: 0, char_end: 10 },
        },
      ])
    })

    it("0 rows over threshold resolves to an empty array (Schicht-2 gate input)", async () => {
      const { client } = createRpcClient({ data: [], error: null })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.retrieve(NOTEBOOK_ID, [0.1])).resolves.toEqual([])
    })

    it("null data resolves to an empty array", async () => {
      const { client } = createRpcClient({ data: null, error: null })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.retrieve(NOTEBOOK_ID, [0.1])).resolves.toEqual([])
    })

    it("error path: throws the Supabase/RPC error", async () => {
      const { client } = createRpcClient({ data: null, error: DB_ERROR })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.retrieve(NOTEBOOK_ID, [0.1])).rejects.toEqual(DB_ERROR)
    })
  })

  describe("retrieveSummaries", () => {
    function createRpcClient(result: QueryResult) {
      const rpc = vi.fn(() => Promise.resolve(result))
      const client = { rpc } as unknown as SupabaseClient<Database>
      return { client, rpc }
    }

    it("calls match_source_summaries and maps rows to summary RetrievedChunks (chunkId/chunkIndex null, metadata {})", async () => {
      const rpcRows = [
        { source_id: "source-1", title: "Doc A", summary: "Worum es geht.", similarity: 0.31 },
      ]
      const { client, rpc } = createRpcClient({ data: rpcRows, error: null })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      const result = await service.retrieveSummaries(NOTEBOOK_ID, [0.1, 0.2, 0.3], 4)

      expect(rpc).toHaveBeenCalledWith("match_source_summaries", {
        p_notebook_id: NOTEBOOK_ID,
        p_query_embedding: "[0.1,0.2,0.3]",
        p_match_count: 4,
      })
      expect(result).toEqual([
        {
          chunkId: null,
          sourceId: "source-1",
          content: "Worum es geht.",
          chunkIndex: null,
          similarity: 0.31,
          metadata: {},
        },
      ])
    })

    it("drops rows with an empty/whitespace summary", async () => {
      const rpcRows = [
        { source_id: "s1", title: "A", summary: "   ", similarity: 0.4 },
        { source_id: "s2", title: "B", summary: "echt", similarity: 0.2 },
      ]
      const { client } = createRpcClient({ data: rpcRows, error: null })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      const result = await service.retrieveSummaries(NOTEBOOK_ID, [0.1], 4)

      expect(result.map((r) => r.sourceId)).toEqual(["s2"])
    })

    it("error path: throws the Supabase/RPC error", async () => {
      const { client } = createRpcClient({ data: null, error: DB_ERROR })
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(service.retrieveSummaries(NOTEBOOK_ID, [0.1], 4)).rejects.toEqual(DB_ERROR)
    })
  })

  describe("persistTurn", () => {
    function createPersistClient(userRow: Message, assistantRow: Message) {
      const insertOrder: string[] = []
      const insertPayloads: unknown[] = []

      function makeChain(result: QueryResult, role: string) {
        const chain: Record<string, unknown> = {}
        chain.insert = vi.fn((payload: unknown) => {
          insertOrder.push(role)
          insertPayloads.push(payload)
          return chain
        })
        chain.select = vi.fn(() => chain)
        chain.single = vi.fn(() => Promise.resolve(result))
        return chain
      }

      let call = 0
      const from = vi.fn(() => {
        call++
        return call === 1
          ? makeChain({ data: userRow, error: null }, "user")
          : makeChain({ data: assistantRow, error: null }, "assistant")
      })

      const client = { from } as unknown as SupabaseClient<Database>
      return { client, from, insertOrder, insertPayloads }
    }

    it("AC-D4/DE-7: inserts the user row before the assistant row, and returns both", async () => {
      const userRow = messageRow({ id: "user-msg", role: "user", content: "Frage" })
      const assistantRow = messageRow({
        id: "assistant-msg",
        role: "assistant",
        content: "Antwort [1].",
        citations: [{ n: 1, chunk_id: "chunk-1", source_id: "source-1" }],
      })
      const { client, from, insertOrder, insertPayloads } = createPersistClient(
        userRow,
        assistantRow
      )
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      const result = await service.persistTurn({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        question: "Frage",
        assistantContent: "Antwort [1].",
        citations: [{ n: 1, chunk_id: "chunk-1", source_id: "source-1" }],
      })

      expect(insertOrder).toEqual(["user", "assistant"])
      expect(from).toHaveBeenNthCalledWith(1, "messages")
      expect(from).toHaveBeenNthCalledWith(2, "messages")
      expect(insertPayloads[0]).toEqual({
        notebook_id: NOTEBOOK_ID,
        user_id: USER_ID,
        role: "user",
        content: "Frage",
      })
      expect(insertPayloads[1]).toEqual({
        notebook_id: NOTEBOOK_ID,
        user_id: USER_ID,
        role: "assistant",
        content: "Antwort [1].",
        citations: [{ n: 1, chunk_id: "chunk-1", source_id: "source-1" }],
      })
      expect(result).toEqual({ userMessage: userRow, assistantMessage: assistantRow })
    })

    it("gate path: persists NO_COVERAGE_MESSAGE with empty citations", async () => {
      const userRow = messageRow({ role: "user", content: "Bundeskanzler?" })
      const assistantRow = messageRow({
        role: "assistant",
        content: NO_COVERAGE_MESSAGE,
        citations: [],
      })
      const { client, insertPayloads } = createPersistClient(userRow, assistantRow)
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await service.persistTurn({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
        question: "Bundeskanzler?",
        assistantContent: NO_COVERAGE_MESSAGE,
        citations: [],
      })

      expect(insertPayloads[1]).toEqual({
        notebook_id: NOTEBOOK_ID,
        user_id: USER_ID,
        role: "assistant",
        content: NO_COVERAGE_MESSAGE,
        citations: [],
      })
    })

    it("error on the user insert: throws and never attempts the assistant insert", async () => {
      const from = vi.fn(() => {
        const chain: Record<string, unknown> = {}
        chain.insert = vi.fn(() => chain)
        chain.select = vi.fn(() => chain)
        chain.single = vi.fn(() => Promise.resolve({ data: null, error: DB_ERROR }))
        return chain
      })
      const client = { from } as unknown as SupabaseClient<Database>
      const service = createChatService({ db: client, embed: vi.fn(), config: CONFIG })

      await expect(
        service.persistTurn({
          notebookId: NOTEBOOK_ID,
          userId: USER_ID,
          question: "Frage",
          assistantContent: "Antwort",
          citations: [],
        })
      ).rejects.toEqual(DB_ERROR)
      expect(from).toHaveBeenCalledTimes(1)
    })
  })

  describe("isRefusal", () => {
    const service = createChatService({
      db: {} as unknown as SupabaseClient<Database>,
      embed: vi.fn(),
      config: CONFIG,
    })

    it("true for an exact match of the canonical constant", () => {
      expect(service.isRefusal(NO_COVERAGE_MESSAGE)).toBe(true)
    })

    it("true after trimming and collapsing incidental whitespace", () => {
      expect(service.isRefusal(`  ${NO_COVERAGE_MESSAGE}\n`)).toBe(true)
      expect(service.isRefusal("Ihre  Quellen enthalten dazu keine Informationen.")).toBe(true)
    })

    it("false for a substantive answer", () => {
      expect(service.isRefusal("Der Umsatz stieg um 12% [1].")).toBe(false)
    })

    it("false for a paraphrased refusal (exact-match only, no fuzzy similarity)", () => {
      expect(
        service.isRefusal("Dazu enthalten Ihre Quellen leider keine Informationen.")
      ).toBe(false)
    })

    it("false for an empty string", () => {
      expect(service.isRefusal("")).toBe(false)
    })
  })
})
