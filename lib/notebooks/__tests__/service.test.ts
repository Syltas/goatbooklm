import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import { createNotebookService, type Notebook } from "../service"

type QueryResult = { data: unknown; error: unknown }

/**
 * Minimal stand-in for Supabase's `PostgrestFilterBuilder`: every chain
 * method (`.select()`, `.insert()`, `.eq()`, …) returns the same object, and
 * the object itself is thenable — `await`ing it (regardless of which method
 * was called last) resolves to the configured `{ data, error }` result. That
 * matches how the real client behaves (each call in the chain is awaitable)
 * without needing a full mock of the query builder's surface.
 */
function createChainable(result: QueryResult) {
  const calls: Record<string, unknown[][]> = {}
  const chainable: Record<string, unknown> = {
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  }

  for (const method of ["select", "insert", "update", "delete", "eq", "order"]) {
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

const USER_ID = "11111111-1111-4111-8111-111111111111"
const NOTEBOOK_ID = "22222222-2222-4222-8222-222222222222"

const NOTEBOOK_ROW: Notebook = {
  id: NOTEBOOK_ID,
  user_id: USER_ID,
  title: "Marketing-Strategie Q3",
  description: "Notizen zur Kampagne",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
}

const DB_ERROR = { message: "connection refused", code: "ECONNREFUSED" }

describe("createNotebookService", () => {
  describe("create", () => {
    it("happy path: inserts with the server-resolved userId and returns the row", async () => {
      const { client, from, calls } = createMockClient({
        data: NOTEBOOK_ROW,
        error: null,
      })
      const service = createNotebookService(client)

      const result = await service.create({
        title: "Marketing-Strategie Q3",
        description: "Notizen zur Kampagne",
        userId: USER_ID,
      })

      expect(result).toEqual(NOTEBOOK_ROW)
      expect(from).toHaveBeenCalledWith("notebooks")
      expect(calls.insert?.[0]?.[0]).toEqual({
        title: "Marketing-Strategie Q3",
        description: "Notizen zur Kampagne",
        user_id: USER_ID,
      })
    })

    it("error path: throws the Supabase error instead of swallowing it", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })
      const service = createNotebookService(client)

      await expect(
        service.create({ title: "X", userId: USER_ID })
      ).rejects.toEqual(DB_ERROR)
    })
  })

  describe("list", () => {
    it("happy path: returns notebooks ordered by updated_at desc", async () => {
      const rows = [NOTEBOOK_ROW]
      const { client, calls } = createMockClient({ data: rows, error: null })
      const service = createNotebookService(client)

      const result = await service.list(USER_ID)

      expect(result).toEqual(rows)
      expect(calls.order?.[0]).toEqual(["updated_at", { ascending: false }])
    })

    it("error path: throws the Supabase error", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })
      const service = createNotebookService(client)

      await expect(service.list(USER_ID)).rejects.toEqual(DB_ERROR)
    })
  })

  describe("getById", () => {
    it("happy path: returns the row for a valid uuid", async () => {
      const { client, calls } = createMockClient({
        data: NOTEBOOK_ROW,
        error: null,
      })
      const service = createNotebookService(client)

      const result = await service.getById(NOTEBOOK_ID, USER_ID)

      expect(result).toEqual(NOTEBOOK_ROW)
      expect(calls.eq?.[0]).toEqual(["id", NOTEBOOK_ID])
    })

    it("error path: throws the Supabase error", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })
      const service = createNotebookService(client)

      await expect(service.getById(NOTEBOOK_ID, USER_ID)).rejects.toEqual(
        DB_ERROR
      )
    })

    it("malformed uuid: resolves to null without throwing or querying (OV9)", async () => {
      const { client, from } = createMockClient({ data: null, error: null })
      const service = createNotebookService(client)

      await expect(
        service.getById("not-a-uuid", USER_ID)
      ).resolves.toBeNull()
      expect(from).not.toHaveBeenCalled()
    })
  })

  describe("update", () => {
    it("happy path: updates only the provided fields and returns the row", async () => {
      const updated = { ...NOTEBOOK_ROW, title: "Neuer Titel" }
      const { client, calls } = createMockClient({ data: updated, error: null })
      const service = createNotebookService(client)

      const result = await service.update(
        NOTEBOOK_ID,
        { title: "Neuer Titel" },
        USER_ID
      )

      expect(result).toEqual(updated)
      expect(calls.update?.[0]?.[0]).toEqual({ title: "Neuer Titel" })
      expect(calls.eq?.[0]).toEqual(["id", NOTEBOOK_ID])
    })

    it("error path: throws when RLS blocks the update (no row returned)", async () => {
      const rlsError = { message: "no rows returned", code: "PGRST116" }
      const { client } = createMockClient({ data: null, error: rlsError })
      const service = createNotebookService(client)

      await expect(
        service.update(NOTEBOOK_ID, { title: "X" }, USER_ID)
      ).rejects.toEqual(rlsError)
    })

    it("malformed uuid: throws a not-found error without querying", async () => {
      const { client, from } = createMockClient({ data: null, error: null })
      const service = createNotebookService(client)

      await expect(
        service.update("not-a-uuid", { title: "X" }, USER_ID)
      ).rejects.toThrow("Notizbuch nicht gefunden")
      expect(from).not.toHaveBeenCalled()
    })
  })

  describe("delete", () => {
    it("happy path: deletes by id and resolves without a value", async () => {
      const { client, calls } = createMockClient({ data: null, error: null })
      const service = createNotebookService(client)

      await expect(
        service.delete(NOTEBOOK_ID, USER_ID)
      ).resolves.toBeUndefined()
      expect(calls.delete?.[0]).toEqual([])
      expect(calls.eq?.[0]).toEqual(["id", NOTEBOOK_ID])
    })

    it("error path: throws the Supabase error", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })
      const service = createNotebookService(client)

      await expect(service.delete(NOTEBOOK_ID, USER_ID)).rejects.toEqual(
        DB_ERROR
      )
    })

    it("malformed uuid: throws a not-found error without querying", async () => {
      const { client, from } = createMockClient({ data: null, error: null })
      const service = createNotebookService(client)

      await expect(
        service.delete("not-a-uuid", USER_ID)
      ).rejects.toThrow("Notizbuch nicht gefunden")
      expect(from).not.toHaveBeenCalled()
    })
  })
})
