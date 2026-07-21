import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/database.types"

import { buildInitialMessages } from "../hydrate"
import type { ChatCitationsData, ChatUIMessage } from "../types"

type MessageRow = Database["public"]["Tables"]["messages"]["Row"]

/**
 * Minimal db stub: `from(table).select(...).in(col, ids)` resolves to the
 * per-table data. Records which tables were queried with which ids so a test
 * can assert a summary citation never enters the `chunks` lookup (a non-uuid
 * there would 22P02 the whole hydration).
 */
function createDb(opts: {
  chunks?: unknown[]
  sources?: unknown[]
  onIn?: (table: string, ids: unknown[]) => void
}): SupabaseClient<Database> {
  return {
    from: (table: string) => ({
      select: () => ({
        in: (_col: string, ids: unknown[]) => {
          opts.onIn?.(table, ids)
          return Promise.resolve({
            data: table === "chunks" ? (opts.chunks ?? []) : (opts.sources ?? []),
            error: null,
          })
        },
      }),
    }),
  } as unknown as SupabaseClient<Database>
}

function assistantRow(citations: unknown): MessageRow {
  return {
    id: "m-assistant",
    notebook_id: "nb",
    user_id: "u",
    role: "assistant",
    content: "Antwort [1][2].",
    citations: citations as MessageRow["citations"],
    created_at: "2026-07-21T10:00:00Z",
  } as MessageRow
}

function citationData(msg: ChatUIMessage): ChatCitationsData {
  const part = msg.parts.find((p) => p.type === "data-citations") as
    | { type: "data-citations"; data: ChatCitationsData }
    | undefined
  if (!part) throw new Error("no data-citations part")
  return part.data
}

describe("buildInitialMessages — summary citations (chunk_id null)", () => {
  it("routes a summary citation to the sources lookup, never into the chunks .in() list", async () => {
    const seenInCalls: Array<{ table: string; ids: unknown[] }> = []
    const db = createDb({
      chunks: [
        { id: "c1", content: "Chunk-Passage", metadata: { char_start: 5, char_end: 20, page: 2 }, chunk_index: 3, sources: { title: "Doc A", type: "pdf" } },
      ],
      sources: [{ id: "s2", title: "Doc B", type: "web", summary: "Doc-Zusammenfassung." }],
      onIn: (table, ids) => seenInCalls.push({ table, ids }),
    })

    const rows = [
      assistantRow([
        { n: 1, chunk_id: "c1", source_id: "s1" },
        { n: 2, chunk_id: null, source_id: "s2" },
      ]),
    ]

    const messages = await buildInitialMessages(db, rows)
    const details = citationData(messages[0]).citations

    // The summary's source id must NOT have been passed to the chunks .in()
    // list — only "c1" (a real chunk id) may reach `from("chunks")`.
    const chunksIn = seenInCalls.find((c) => c.table === "chunks")
    expect(chunksIn?.ids).toEqual(["c1"])
    const sourcesIn = seenInCalls.find((c) => c.table === "sources")
    expect(sourcesIn?.ids).toEqual(["s2"])

    // Chunk citation: full detail with offsets + paragraph.
    expect(details[0]).toMatchObject({
      n: 1,
      chunkId: "c1",
      sourceTitle: "Doc A",
      sourceType: "pdf",
      content: "Chunk-Passage",
      charStart: 5,
      charEnd: 20,
      page: 2,
      paragraph: 4,
    })

    // Summary citation: title/type/content from sources, no offsets/paragraph.
    expect(details[1]).toMatchObject({
      n: 2,
      chunkId: null,
      sourceId: "s2",
      sourceTitle: "Doc B",
      sourceType: "web",
      content: "Doc-Zusammenfassung.",
    })
    expect(details[1].charStart).toBeUndefined()
    expect(details[1].page).toBeUndefined()
    expect(details[1].paragraph).toBeUndefined()
  })

  it("does not query chunks at all when every citation is a summary", async () => {
    const seen: string[] = []
    const db = createDb({
      sources: [{ id: "s9", title: "Nur Summary", type: "text", summary: "Text." }],
      onIn: (table) => seen.push(table),
    })

    const messages = await buildInitialMessages(db, [
      assistantRow([{ n: 1, chunk_id: null, source_id: "s9" }]),
    ])

    expect(seen).toEqual(["sources"])
    expect(citationData(messages[0]).citations[0]).toMatchObject({
      chunkId: null,
      sourceTitle: "Nur Summary",
      content: "Text.",
    })
  })
})
