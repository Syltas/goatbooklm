import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import { createNoteService, DEFAULT_NOTE_TITLE, type Note } from "../service"

type QueryResult = { data: unknown; error: unknown }

/**
 * Same thenable-chainable stand-in as `lib/notebooks/__tests__/service.test.ts`
 * — every chain method returns the same object, and the object itself is
 * thenable so `await`ing it (regardless of which method was called last)
 * resolves to the configured `{ data, error }` result.
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
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333"
const NOTEBOOK_ID = "22222222-2222-4222-8222-222222222222"
const NOTE_ID = "44444444-4444-4444-8444-444444444444"

const NOTE_ROW: Note = {
  id: NOTE_ID,
  notebook_id: NOTEBOOK_ID,
  user_id: USER_ID,
  title: "Meine Notiz",
  content: {},
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
}

const DB_ERROR = { message: "connection refused", code: "ECONNREFUSED" }

describe("createNoteService", () => {
  describe("assertNotebookOwned", () => {
    it("happy path: returns the row when RLS lets the notebook through", async () => {
      const { client, from } = createMockClient({
        data: { id: NOTEBOOK_ID },
        error: null,
      })

      const result = await createNoteService(client).assertNotebookOwned(NOTEBOOK_ID)

      expect(from).toHaveBeenCalledWith("notebooks")
      expect(result).toEqual({ id: NOTEBOOK_ID })
    })

    it("returns null for a foreign or non-existent notebook (indistinguishable under RLS)", async () => {
      const { client } = createMockClient({ data: null, error: null })

      await expect(
        createNoteService(client).assertNotebookOwned(NOTEBOOK_ID)
      ).resolves.toBeNull()
    })

    it("malformed uuid: resolves to null without querying", async () => {
      const { client, from } = createMockClient({ data: null, error: null })

      await expect(
        createNoteService(client).assertNotebookOwned("not-a-uuid")
      ).resolves.toBeNull()
      expect(from).not.toHaveBeenCalled()
    })

    it("error path: rethrows a DB error instead of reporting ownership", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })

      await expect(
        createNoteService(client).assertNotebookOwned(NOTEBOOK_ID)
      ).rejects.toBe(DB_ERROR)
    })
  })

  describe("create", () => {
    it("happy path: inserts with the server-resolved userId and a default title", async () => {
      const { client, from, calls } = createMockClient({
        data: NOTE_ROW,
        error: null,
      })

      const result = await createNoteService(client).create({
        notebookId: NOTEBOOK_ID,
        userId: USER_ID,
      })

      expect(result).toEqual(NOTE_ROW)
      expect(from).toHaveBeenCalledWith("notes")
      expect(calls.insert?.[0]?.[0]).toEqual({
        notebook_id: NOTEBOOK_ID,
        user_id: USER_ID,
        title: DEFAULT_NOTE_TITLE,
      })
    })

    it("error path: throws the Supabase error instead of swallowing it", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })

      await expect(
        createNoteService(client).create({ notebookId: NOTEBOOK_ID, userId: USER_ID })
      ).rejects.toEqual(DB_ERROR)
    })
  })

  describe("list", () => {
    it("happy path: returns notes of one notebook ordered by updated_at desc", async () => {
      const rows = [NOTE_ROW]
      const { client, from, calls } = createMockClient({ data: rows, error: null })

      const result = await createNoteService(client).list(NOTEBOOK_ID)

      expect(result).toEqual(rows)
      expect(from).toHaveBeenCalledWith("notes")
      expect(calls.eq?.[0]).toEqual(["notebook_id", NOTEBOOK_ID])
      expect(calls.order?.[0]).toEqual(["updated_at", { ascending: false }])
    })

    it("returns an empty array rather than null when there are no notes", async () => {
      const { client } = createMockClient({ data: null, error: null })

      await expect(createNoteService(client).list(NOTEBOOK_ID)).resolves.toEqual([])
    })

    it("error path: throws the Supabase error", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })

      await expect(createNoteService(client).list(NOTEBOOK_ID)).rejects.toEqual(DB_ERROR)
    })
  })

  describe("getById", () => {
    it("happy path: returns the row for a valid uuid", async () => {
      const { client, calls } = createMockClient({ data: NOTE_ROW, error: null })

      const result = await createNoteService(client).getById(NOTE_ID)

      expect(result).toEqual(NOTE_ROW)
      expect(calls.eq?.[0]).toEqual(["id", NOTE_ID])
    })

    it("returns null for a foreign or non-existent note (indistinguishable under RLS)", async () => {
      const { client } = createMockClient({ data: null, error: null })

      await expect(createNoteService(client).getById(NOTE_ID)).resolves.toBeNull()
    })

    it("malformed uuid: resolves to null without querying", async () => {
      const { client, from } = createMockClient({ data: null, error: null })

      await expect(createNoteService(client).getById("not-a-uuid")).resolves.toBeNull()
      expect(from).not.toHaveBeenCalled()
    })

    it("error path: throws the Supabase error", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })

      await expect(createNoteService(client).getById(NOTE_ID)).rejects.toEqual(DB_ERROR)
    })
  })

  describe("update", () => {
    it("happy path: updates only the title and returns the row", async () => {
      const updated = { ...NOTE_ROW, title: "Neuer Titel" }
      const { client, calls } = createMockClient({ data: updated, error: null })

      const result = await createNoteService(client).update(
        NOTE_ID,
        { title: "Neuer Titel" },
        USER_ID
      )

      expect(result).toEqual(updated)
      expect(calls.update?.[0]?.[0]).toEqual({ title: "Neuer Titel" })
      expect(calls.eq?.[0]).toEqual(["id", NOTE_ID])
    })

    it("error path: throws when RLS blocks the update (no row returned)", async () => {
      const rlsError = { message: "no rows returned", code: "PGRST116" }
      const { client } = createMockClient({ data: null, error: rlsError })

      await expect(
        createNoteService(client).update(NOTE_ID, { title: "X" }, OTHER_USER_ID)
      ).rejects.toEqual(rlsError)
    })

    it("content-only: updates only content, leaving title untouched", async () => {
      const content = { type: "doc", content: [{ type: "paragraph" }] }
      const updated = { ...NOTE_ROW, content }
      const { client, calls } = createMockClient({ data: updated, error: null })

      const result = await createNoteService(client).update(NOTE_ID, { content }, USER_ID)

      expect(result).toEqual(updated)
      expect(calls.update?.[0]?.[0]).toEqual({ content })
    })

    it("title + content together: both land in a single patch", async () => {
      const content = { type: "doc", content: [{ type: "paragraph" }] }
      const updated = { ...NOTE_ROW, title: "Neuer Titel", content }
      const { client, calls } = createMockClient({ data: updated, error: null })

      const result = await createNoteService(client).update(
        NOTE_ID,
        { title: "Neuer Titel", content },
        USER_ID
      )

      expect(result).toEqual(updated)
      expect(calls.update?.[0]?.[0]).toEqual({ title: "Neuer Titel", content })
    })

    it("malformed uuid: throws a not-found error without querying", async () => {
      const { client, from } = createMockClient({ data: null, error: null })

      await expect(
        createNoteService(client).update("not-a-uuid", { title: "X" }, USER_ID)
      ).rejects.toThrow("Notiz nicht gefunden")
      expect(from).not.toHaveBeenCalled()
    })
  })

  describe("delete", () => {
    it("happy path: deletes by id and resolves without a value", async () => {
      const { client, calls } = createMockClient({ data: null, error: null })

      await expect(
        createNoteService(client).delete(NOTE_ID, USER_ID)
      ).resolves.toBeUndefined()
      expect(calls.delete?.[0]).toEqual([])
      expect(calls.eq?.[0]).toEqual(["id", NOTE_ID])
    })

    it("error path: throws the Supabase error", async () => {
      const { client } = createMockClient({ data: null, error: DB_ERROR })

      await expect(createNoteService(client).delete(NOTE_ID, USER_ID)).rejects.toEqual(
        DB_ERROR
      )
    })

    it("malformed uuid: throws a not-found error without querying", async () => {
      const { client, from } = createMockClient({ data: null, error: null })

      await expect(
        createNoteService(client).delete("not-a-uuid", USER_ID)
      ).rejects.toThrow("Notiz nicht gefunden")
      expect(from).not.toHaveBeenCalled()
    })
  })
})
