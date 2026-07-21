import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import { createStudioService } from "../service"

type QueryResult = { data: unknown; error: unknown }
type CallLog = { method: string; args: unknown[] }[]

/** Kompakte Variante des table-aware Chainable-Mocks aus
 *  `lib/ingestion/__tests__/service.test.ts` — plus `.or()`, das der
 *  Retry-Guard nutzt. */
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
      const queue = (queues[table] ??= [])
      return queue.shift() ?? { data: null, error: null }
    }

    const chainable: Record<string, unknown> = {
      then: (
        onFulfilled: (v: QueryResult) => unknown,
        onRejected?: (r: unknown) => unknown
      ) => Promise.resolve(nextResult()).then(onFulfilled, onRejected),
    }

    for (const method of ["select", "insert", "update", "delete", "eq", "in", "or", "order"]) {
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
    callsByTable,
  }
}

describe("loadReadySources", () => {
  it("filtert Quellen mit leerem/null content_text raus", async () => {
    const { client } = createMockClient({
      sources: [
        {
          data: [
            { id: "a", title: "Voll", content_text: "Inhalt" },
            { id: "b", title: "Leer", content_text: "   " },
            { id: "c", title: "Null", content_text: null },
          ],
          error: null,
        },
      ],
    })
    const service = createStudioService({ db: client })
    const sources = await service.loadReadySources("nb-1")
    expect(sources).toEqual([{ id: "a", title: "Voll", contentText: "Inhalt" }])
  })
})

describe("claimRetry", () => {
  it("setzt konditional zurück und liefert die Row", async () => {
    const row = { id: "art-1", status: "generating", format: "briefing_doc" }
    const { client, callsByTable } = createMockClient({
      studio_artifacts: [{ data: row, error: null }],
    })
    const service = createStudioService({ db: client })
    const claimed = await service.claimRetry({
      artifactId: "art-1",
      notebookId: "nb-1",
      sourceIds: ["s1"],
      provisionalTitle: "Briefing-Dokument",
    })
    expect(claimed).toEqual(row)

    const orCall = callsByTable.studio_artifacts.find((c) => c.method === "or")
    expect(orCall).toBeDefined()
    // Guard: nur failed ODER stale-generating (updated_at-basiert) resetten
    expect(String(orCall?.args[0])).toMatch(
      /status\.eq\.failed,and\(status\.eq\.generating,updated_at\.lt\./
    )
    const updateCall = callsByTable.studio_artifacts.find((c) => c.method === "update")
    expect(updateCall?.args[0]).toMatchObject({
      status: "generating",
      content: null,
      error_message: null,
      source_ids: ["s1"],
    })
  })

  it("liefert null, wenn der Guard 0 Rows trifft (laufende Generierung)", async () => {
    const { client } = createMockClient({
      studio_artifacts: [{ data: null, error: null }],
    })
    const service = createStudioService({ db: client })
    const claimed = await service.claimRetry({
      artifactId: "art-1",
      notebookId: "nb-1",
      sourceIds: [],
      provisionalTitle: "Briefing-Dokument",
    })
    expect(claimed).toBeNull()
  })
})

describe("finalizeReady", () => {
  it("persistiert Titel + Content generisch und leert error_message", async () => {
    const { client, callsByTable } = createMockClient({
      studio_artifacts: [{ data: null, error: null }],
    })
    const service = createStudioService({ db: client })

    await service.finalizeReady({
      artifactId: "a",
      title: "T",
      content: { markdown: "Body" },
    })

    const update = callsByTable.studio_artifacts.find((c) => c.method === "update")
    expect(update?.args[0]).toMatchObject({
      status: "ready",
      title: "T",
      content: { markdown: "Body" },
      error_message: null,
    })
  })
})

describe("loadReadySources mit Auswahl", () => {
  it("filtert per .in() auf die gewählten sourceIds", async () => {
    const { client, callsByTable } = createMockClient({
      sources: [{ data: [], error: null }],
    })
    const service = createStudioService({ db: client })
    await service.loadReadySources("nb-1", ["s1", "s2"])
    const inCall = callsByTable.sources.find((c) => c.method === "in")
    expect(inCall?.args).toEqual(["id", ["s1", "s2"]])
  })

  it("lässt den Filter bei leerer Auswahl weg", async () => {
    const { client, callsByTable } = createMockClient({
      sources: [{ data: [], error: null }],
    })
    const service = createStudioService({ db: client })
    await service.loadReadySources("nb-1", [])
    expect(callsByTable.sources.find((c) => c.method === "in")).toBeUndefined()
  })
})

describe("renameArtifact", () => {
  it("liefert null bei 0 getroffenen Rows (fremd/nicht existent)", async () => {
    const { client } = createMockClient({
      studio_artifacts: [{ data: null, error: null }],
    })
    const service = createStudioService({ db: client })
    const result = await service.renameArtifact({ artifactId: "x", title: "Neu" })
    expect(result).toBeNull()
  })
})

const DB_ERROR = { message: "connection refused", code: "ECONNREFUSED" }

describe("assertNotebookOwned", () => {
  it("happy path: liefert die Row, wenn RLS das Notebook durchlässt", async () => {
    const { client, callsByTable } = createMockClient({
      notebooks: [{ data: { id: "nb-1" }, error: null }],
    })
    const service = createStudioService({ db: client })
    const result = await service.assertNotebookOwned("nb-1")
    expect(result).toEqual({ id: "nb-1" })
    const eqCall = callsByTable.notebooks.find((c) => c.method === "eq")
    expect(eqCall?.args).toEqual(["id", "nb-1"])
  })

  it("returns null for a foreign or non-existent notebook", async () => {
    const { client } = createMockClient({ notebooks: [{ data: null, error: null }] })
    const service = createStudioService({ db: client })
    await expect(service.assertNotebookOwned("nb-x")).resolves.toBeNull()
  })

  it("error path: wirft den DB-Fehler statt Ownership zu melden", async () => {
    const { client } = createMockClient({
      notebooks: [{ data: null, error: DB_ERROR }],
    })
    const service = createStudioService({ db: client })
    await expect(service.assertNotebookOwned("nb-1")).rejects.toEqual(DB_ERROR)
  })
})

describe("getOwnedArtifact", () => {
  it("happy path: liefert die Artefakt-Row", async () => {
    const row = { id: "art-1", status: "ready" }
    const { client, callsByTable } = createMockClient({
      studio_artifacts: [{ data: row, error: null }],
    })
    const service = createStudioService({ db: client })
    const result = await service.getOwnedArtifact("art-1")
    expect(result).toEqual(row)
    const eqCall = callsByTable.studio_artifacts.find((c) => c.method === "eq")
    expect(eqCall?.args).toEqual(["id", "art-1"])
  })

  it("returns null for a foreign or non-existent artifact", async () => {
    const { client } = createMockClient({
      studio_artifacts: [{ data: null, error: null }],
    })
    const service = createStudioService({ db: client })
    await expect(service.getOwnedArtifact("art-x")).resolves.toBeNull()
  })

  it("error path: wirft den DB-Fehler statt Ownership zu melden", async () => {
    const { client } = createMockClient({
      studio_artifacts: [{ data: null, error: DB_ERROR }],
    })
    const service = createStudioService({ db: client })
    await expect(service.getOwnedArtifact("art-1")).rejects.toEqual(DB_ERROR)
  })
})

describe("createGeneratingArtifact", () => {
  it("happy path: inserted eine generating-Row mit allen Feldern", async () => {
    const row = { id: "art-1", status: "generating" }
    const { client, callsByTable } = createMockClient({
      studio_artifacts: [{ data: row, error: null }],
    })
    const service = createStudioService({ db: client })
    const result = await service.createGeneratingArtifact({
      notebookId: "nb-1",
      userId: "user-1",
      type: "report",
      format: "briefing_doc",
      provisionalTitle: "Neuer Bericht",
      sourceIds: ["s1", "s2"],
    })
    expect(result).toEqual(row)
    const insertCall = callsByTable.studio_artifacts.find((c) => c.method === "insert")
    expect(insertCall?.args[0]).toEqual({
      notebook_id: "nb-1",
      user_id: "user-1",
      type: "report",
      format: "briefing_doc",
      title: "Neuer Bericht",
      status: "generating",
      source_ids: ["s1", "s2"],
      content: null,
    })
  })
})

describe("finalizeFailed", () => {
  it("happy path: setzt status failed + error_message", async () => {
    const { client, callsByTable } = createMockClient({
      studio_artifacts: [{ data: null, error: null }],
    })
    const service = createStudioService({ db: client })
    await service.finalizeFailed({ artifactId: "art-1", errorMessage: "Boom" })
    const updateCall = callsByTable.studio_artifacts.find((c) => c.method === "update")
    expect(updateCall?.args[0]).toEqual({ status: "failed", error_message: "Boom" })
    const eqCall = callsByTable.studio_artifacts.find((c) => c.method === "eq")
    expect(eqCall?.args).toEqual(["id", "art-1"])
  })
})

describe("listArtifacts", () => {
  it("happy path: liefert Artefakte eines Notebooks, neueste zuerst", async () => {
    const rows = [{ id: "art-2" }, { id: "art-1" }]
    const { client, callsByTable } = createMockClient({
      studio_artifacts: [{ data: rows, error: null }],
    })
    const service = createStudioService({ db: client })
    const result = await service.listArtifacts("nb-1")
    expect(result).toEqual(rows)
    const eqCall = callsByTable.studio_artifacts.find((c) => c.method === "eq")
    expect(eqCall?.args).toEqual(["notebook_id", "nb-1"])
    const orderCall = callsByTable.studio_artifacts.find((c) => c.method === "order")
    expect(orderCall?.args).toEqual(["created_at", { ascending: false }])
  })
})

describe("deleteArtifact", () => {
  it("happy path: löscht per id", async () => {
    const { client, callsByTable } = createMockClient({
      studio_artifacts: [{ data: null, error: null }],
    })
    const service = createStudioService({ db: client })
    await expect(service.deleteArtifact("art-1")).resolves.toBeUndefined()
    const eqCall = callsByTable.studio_artifacts.find((c) => c.method === "eq")
    expect(eqCall?.args).toEqual(["id", "art-1"])
  })
})
