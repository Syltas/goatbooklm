import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import {
  buildCorpusBlock,
  buildExcerpt,
  createNotebookSummaryService,
  invalidateNotebookSummary,
  type SummarizeFn,
} from "../summary-service"

type QueryResult = { data: unknown; error: unknown }

/**
 * Minimal chainable mock scoped to exactly what this service touches:
 * `sources` (select/eq/in/gte/order/limit, resolved by `await`ing the chain
 * or via `maybeSingle()`) and `notebooks` (update/eq or select/maybeSingle)
 * — mirrors the chainable-mock technique in
 * `lib/ingestion/__tests__/service.test.ts`, trimmed to this module's
 * narrower query shape.
 *
 * A table's entry may be a QueryResult ARRAY: `regenerateWhenSettled` issues
 * several successive queries against the SAME table with different expected
 * results (e.g. `sources` once for the in-flight check, once for the ready
 * corpus) — each `from(table)` call consumes the next array entry in order.
 */
function createMockClient(responsesByTable: Record<string, QueryResult | QueryResult[]>) {
  const updateCallsByTable: Record<string, unknown[]> = {}

  function nextResult(table: string): QueryResult {
    const entry = responsesByTable[table]
    if (Array.isArray(entry)) return entry.shift() ?? { data: null, error: null }
    return entry ?? { data: null, error: null }
  }

  function chainableFor(table: string) {
    const result = nextResult(table)
    const chainable: Record<string, unknown> = {
      then: (onFulfilled: (v: QueryResult) => unknown, onRejected?: (r: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    }
    for (const method of ["select", "eq", "in", "gte", "order", "limit"]) {
      chainable[method] = vi.fn(() => chainable)
    }
    chainable.maybeSingle = vi.fn(() => Promise.resolve(result))
    chainable.update = vi.fn((payload: unknown) => {
      updateCallsByTable[table] ??= []
      updateCallsByTable[table].push(payload)
      return chainable
    })
    return chainable
  }

  const from = vi.fn((table: string) => chainableFor(table))

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    updateCallsByTable,
  }
}

describe("buildExcerpt", () => {
  it("passes short text through unchanged", () => {
    expect(buildExcerpt("kurzer text")).toBe("kurzer text")
  })

  it("caps long text at the per-source character limit", () => {
    const long = "a".repeat(20_000)
    const excerpt = buildExcerpt(long)
    expect(excerpt.length).toBe(12_000)
    expect(excerpt).toBe("a".repeat(12_000))
  })
})

describe("buildCorpusBlock", () => {
  it("renders a ###-delimited block per source", () => {
    const block = buildCorpusBlock([
      { title: "Quelle A", excerpt: "Text A" },
      { title: "Quelle B", excerpt: "Text B" },
    ])
    expect(block).toBe("### Quelle A\nText A\n\n### Quelle B\nText B")
  })
})

describe("NotebookSummaryService.regenerate", () => {
  it("direct single-call path: summarizes once and persists summary + summary_stale=false", async () => {
    const { client, updateCallsByTable } = createMockClient({
      sources: {
        data: [
          { title: "Quelle A", content_text: "Inhalt A" },
          { title: "Quelle B", content_text: "Inhalt B" },
        ],
        error: null,
      },
      notebooks: { data: null, error: null },
    })

    const summarize: SummarizeFn = vi.fn().mockResolvedValue("Zusammenfassung des Notizbuchs.")
    const service = createNotebookSummaryService({ db: client, summarize })

    await service.regenerate("nb-1")

    expect(summarize).toHaveBeenCalledTimes(1)
    const call = (summarize as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.prompt).toContain("Quelle A")
    expect(call.prompt).toContain("Quelle B")

    expect(updateCallsByTable.notebooks).toEqual([
      { summary: "Zusammenfassung des Notizbuchs.", summary_stale: false },
    ])
  })

  it("map-reduce path: falls back once the combined excerpt length exceeds the single-call budget", async () => {
    // 9 sources at the 12,000-char per-source cap = 108,000 combined chars,
    // above the 96,000-char single-call ceiling — forces the map-reduce
    // branch (one map call per source + one reduce call = 10 total).
    const bigSources = Array.from({ length: 9 }, (_, i) => ({
      title: `Quelle ${i + 1}`,
      content_text: "x".repeat(20_000),
    }))

    const { client, updateCallsByTable } = createMockClient({
      sources: { data: bigSources, error: null },
      notebooks: { data: null, error: null },
    })

    const summarize: SummarizeFn = vi
      .fn()
      .mockResolvedValueOnce("map 1")
      .mockResolvedValueOnce("map 2")
      .mockResolvedValueOnce("map 3")
      .mockResolvedValueOnce("map 4")
      .mockResolvedValueOnce("map 5")
      .mockResolvedValueOnce("map 6")
      .mockResolvedValueOnce("map 7")
      .mockResolvedValueOnce("map 8")
      .mockResolvedValueOnce("map 9")
      .mockResolvedValueOnce("finale zusammenfassung")

    const service = createNotebookSummaryService({ db: client, summarize })
    await service.regenerate("nb-2")

    expect(summarize).toHaveBeenCalledTimes(10)
    // The last call is the reduce step, fed the (short) per-source
    // summaries, not the original 20,000-char excerpts.
    const lastCall = (summarize as ReturnType<typeof vi.fn>).mock.calls[9][0]
    expect(lastCall.prompt).toContain("map 1")
    expect(lastCall.prompt).toContain("map 9")
    expect(lastCall.prompt.length).toBeLessThan(1000)

    expect(updateCallsByTable.notebooks).toEqual([
      { summary: "finale zusammenfassung", summary_stale: false },
    ])
  })

  it("no ready sources: no-op, no summarize call, no DB write", async () => {
    const { client, updateCallsByTable } = createMockClient({
      sources: { data: [], error: null },
    })
    const summarize: SummarizeFn = vi.fn()
    const service = createNotebookSummaryService({ db: client, summarize })

    await service.regenerate("nb-3")

    expect(summarize).not.toHaveBeenCalled()
    expect(updateCallsByTable.notebooks).toBeUndefined()
  })

  it("summarize() rejecting is swallowed — logged, does not throw, no DB write", async () => {
    const { client, updateCallsByTable } = createMockClient({
      sources: { data: [{ title: "Quelle A", content_text: "Inhalt" }], error: null },
    })
    const summarize: SummarizeFn = vi.fn().mockRejectedValue(new Error("Anthropic down"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const service = createNotebookSummaryService({ db: client, summarize })

    await expect(service.regenerate("nb-4")).resolves.toBeUndefined()

    expect(updateCallsByTable.notebooks).toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("an empty (whitespace-only) model response is treated as a failure, not persisted", async () => {
    const { client, updateCallsByTable } = createMockClient({
      sources: { data: [{ title: "Quelle A", content_text: "Inhalt" }], error: null },
    })
    const summarize: SummarizeFn = vi.fn().mockResolvedValue("   ")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const service = createNotebookSummaryService({ db: client, summarize })

    await service.regenerate("nb-5")

    expect(updateCallsByTable.notebooks).toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("a sources-select DB error is swallowed — logged, does not throw", async () => {
    const { client } = createMockClient({
      sources: { data: null, error: new Error("connection reset") },
    })
    const summarize: SummarizeFn = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const service = createNotebookSummaryService({ db: client, summarize })

    await expect(service.regenerate("nb-6")).resolves.toBeUndefined()
    expect(summarize).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe("NotebookSummaryService.regenerateWhenSettled", () => {
  it("corpusChanged with nothing in flight: flips summary_stale, then regenerates immediately", async () => {
    const { client, updateCallsByTable } = createMockClient({
      notebooks: [
        { data: null, error: null }, // summary_stale=true update
        { data: null, error: null }, // final summary update
      ],
      sources: [
        { data: [], error: null }, // in-flight check: notebook settled
        { data: [{ title: "Quelle A", content_text: "Inhalt A" }], error: null }, // ready corpus
      ],
    })
    const summarize: SummarizeFn = vi.fn().mockResolvedValue("Zusammenfassung.")
    const service = createNotebookSummaryService({ db: client, summarize })

    await service.regenerateWhenSettled("nb-10", { corpusChanged: true })

    expect(summarize).toHaveBeenCalledTimes(1)
    expect(updateCallsByTable.notebooks).toEqual([
      { summary_stale: true },
      { summary: "Zusammenfassung.", summary_stale: false },
    ])
  })

  it("corpusChanged with another source in flight: flips summary_stale, skips the LLM entirely", async () => {
    const { client, updateCallsByTable } = createMockClient({
      notebooks: [{ data: null, error: null }],
      sources: [{ data: [{ id: "source-in-flight" }], error: null }],
    })
    const summarize: SummarizeFn = vi.fn()
    const service = createNotebookSummaryService({ db: client, summarize })

    await service.regenerateWhenSettled("nb-11", { corpusChanged: true })

    expect(summarize).not.toHaveBeenCalled()
    // The stale flag is the hand-off to whichever parallel invocation
    // settles the notebook last — it MUST be persisted despite the skip.
    expect(updateCallsByTable.notebooks).toEqual([{ summary_stale: true }])
  })

  it("no corpus change (error/dead-letter settled the notebook) with a pending stale flag: catches up with a regeneration", async () => {
    const { client, updateCallsByTable } = createMockClient({
      notebooks: [
        { data: { summary_stale: true }, error: null }, // stale lookup
        { data: null, error: null }, // final summary update
      ],
      sources: [
        { data: [], error: null }, // in-flight check
        { data: [{ title: "Quelle A", content_text: "Inhalt A" }], error: null },
      ],
    })
    const summarize: SummarizeFn = vi.fn().mockResolvedValue("Nachgeholte Zusammenfassung.")
    const service = createNotebookSummaryService({ db: client, summarize })

    await service.regenerateWhenSettled("nb-12", { corpusChanged: false })

    expect(summarize).toHaveBeenCalledTimes(1)
    expect(updateCallsByTable.notebooks).toEqual([
      { summary: "Nachgeholte Zusammenfassung.", summary_stale: false },
    ])
  })

  it("no corpus change and not stale: full no-op, no LLM call, no DB write", async () => {
    const { client, updateCallsByTable } = createMockClient({
      notebooks: [{ data: { summary_stale: false }, error: null }],
      sources: [{ data: [], error: null }],
    })
    const summarize: SummarizeFn = vi.fn()
    const service = createNotebookSummaryService({ db: client, summarize })

    await service.regenerateWhenSettled("nb-13", { corpusChanged: false })

    expect(summarize).not.toHaveBeenCalled()
    expect(updateCallsByTable.notebooks).toBeUndefined()
  })

  it("a DB error is swallowed — logged, never throws", async () => {
    const { client } = createMockClient({
      notebooks: [{ data: null, error: new Error("connection reset") }],
    })
    const summarize: SummarizeFn = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const service = createNotebookSummaryService({ db: client, summarize })

    await expect(
      service.regenerateWhenSettled("nb-14", { corpusChanged: true })
    ).resolves.toBeUndefined()

    expect(summarize).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe("invalidateNotebookSummary", () => {
  it("flips summary_stale to true", async () => {
    const { client, updateCallsByTable } = createMockClient({
      notebooks: { data: null, error: null },
    })

    await invalidateNotebookSummary(client, "nb-7")

    expect(updateCallsByTable.notebooks).toEqual([{ summary_stale: true }])
  })

  it("a DB error is logged, not thrown", async () => {
    const { client } = createMockClient({
      notebooks: { data: null, error: new Error("connection reset") },
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(invalidateNotebookSummary(client, "nb-8")).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
