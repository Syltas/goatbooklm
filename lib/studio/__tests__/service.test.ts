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

    for (const method of ["select", "insert", "update", "delete", "eq", "or", "order"]) {
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
  it("persistiert truncated nur wenn wahr", async () => {
    const { client, callsByTable } = createMockClient({
      studio_artifacts: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    })
    const service = createStudioService({ db: client })

    await service.finalizeReady({
      artifactId: "a",
      title: "T",
      markdown: "Body",
      truncated: false,
    })
    await service.finalizeReady({
      artifactId: "a",
      title: "T",
      markdown: "Body",
      truncated: true,
    })

    const updates = callsByTable.studio_artifacts.filter((c) => c.method === "update")
    expect(updates[0]?.args[0]).toMatchObject({ content: { markdown: "Body" } })
    expect((updates[0]?.args[0] as { content: Record<string, unknown> }).content).not.toHaveProperty(
      "truncated"
    )
    expect(updates[1]?.args[0]).toMatchObject({
      content: { markdown: "Body", truncated: true },
    })
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
