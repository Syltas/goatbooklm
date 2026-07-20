import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import { createChatHistoryService } from "../service"

type QueryResult = { data: unknown; error: unknown; count?: number | null }

const NOTEBOOK_ID = "22222222-2222-4222-8222-222222222222"
const USER_ID = "11111111-1111-4111-8111-111111111111"
const DB_ERROR = { message: "connection refused", code: "ECONNREFUSED" }

/** Same thenable-chainable stand-in as `service.test.ts`, plus `delete`. */
function createMockClient(result: QueryResult) {
  const calls: Record<string, unknown[][]> = {}
  const chainable: Record<string, unknown> = {
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  }

  for (const method of ["select", "delete", "eq"]) {
    chainable[method] = vi.fn((...args: unknown[]) => {
      calls[method] ??= []
      calls[method].push(args)
      return chainable
    })
  }

  chainable.maybeSingle = vi.fn(() => Promise.resolve(result))

  const from = vi.fn(() => chainable)
  const client = { from } as unknown as SupabaseClient<Database>
  return { client, from, calls }
}

describe("createChatHistoryService", () => {
  describe("assertNotebookOwned", () => {
    it("happy path: returns the row when RLS lets the notebook through", async () => {
      const { client, from } = createMockClient({ data: { id: NOTEBOOK_ID }, error: null })

      const result = await createChatHistoryService(client).assertNotebookOwned(NOTEBOOK_ID)

      expect(from).toHaveBeenCalledWith("notebooks")
      expect(result).toEqual({ id: NOTEBOOK_ID })
    })

    it("returns null for a foreign or non-existent notebook (indistinguishable under RLS)", async () => {
      const { client } = createMockClient({ data: null, error: null })

      await expect(
        createChatHistoryService(client).assertNotebookOwned(NOTEBOOK_ID)
      ).resolves.toBeNull()
    })

    it("error path: rethrows a DB error instead of reporting ownership", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })

      await expect(
        createChatHistoryService(client).assertNotebookOwned(NOTEBOOK_ID)
      ).rejects.toBe(DB_ERROR)
    })
  })

  describe("deleteHistory", () => {
    it("happy path: deletes by notebook AND user, returning the row count", async () => {
      const { client, from, calls } = createMockClient({ data: null, error: null, count: 4 })

      const deleted = await createChatHistoryService(client).deleteHistory(NOTEBOOK_ID, USER_ID)

      expect(deleted).toBe(4)
      expect(from).toHaveBeenCalledWith("messages")
      expect(calls.delete?.[0]).toEqual([{ count: "exact" }])
      // The user_id filter is defense in depth on top of the RLS policy —
      // dropping it must fail this test.
      expect(calls.eq).toEqual([
        ["notebook_id", NOTEBOOK_ID],
        ["user_id", USER_ID],
      ])
    })

    it("returns 0 when there was no history to delete", async () => {
      const { client } = createMockClient({ data: null, error: null, count: null })

      await expect(
        createChatHistoryService(client).deleteHistory(NOTEBOOK_ID, USER_ID)
      ).resolves.toBe(0)
    })

    it("error path: rethrows a DB error so the action never reports a false success", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })

      await expect(
        createChatHistoryService(client).deleteHistory(NOTEBOOK_ID, USER_ID)
      ).rejects.toBe(DB_ERROR)
    })
  })
})
