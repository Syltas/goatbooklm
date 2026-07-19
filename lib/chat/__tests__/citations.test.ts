import { describe, expect, it } from "vitest"

import type { RetrievedChunk } from "../types"
import { parseCitations } from "../citations"

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: "chunk-id",
    sourceId: "source-id",
    content: "content",
    chunkIndex: 0,
    similarity: 0.9,
    metadata: {},
    ...overrides,
  }
}

function chunks(n: number): RetrievedChunk[] {
  return Array.from({ length: n }, (_, i) =>
    chunk({ chunkId: `chunk-${i + 1}`, sourceId: `source-${i + 1}` })
  )
}

describe("parseCitations", () => {
  it("no marker: returns the text unchanged with empty citations", () => {
    const result = parseCitations("Es gibt keine Zitate hier.", chunks(3))

    expect(result).toEqual({
      cleanedContent: "Es gibt keine Zitate hier.",
      citations: [],
      invalidCount: 0,
      validCount: 0,
    })
  })

  it("AC-E1: a valid marker produces a citation entry and the marker stays in the text", () => {
    const source = chunks(2)
    const result = parseCitations("Die Antwort steht hier [2].", source)

    expect(result.cleanedContent).toBe("Die Antwort steht hier [2].")
    expect(result.citations).toEqual([{ n: 2, chunk_id: "chunk-2", source_id: "source-2" }])
    expect(result.validCount).toBe(1)
    expect(result.invalidCount).toBe(0)
  })

  it("AC-E2: a hallucinated marker (n > chunks.length) is stripped and counted invalid, no citation entry", () => {
    const source = chunks(8)
    const result = parseCitations("Fakt [9] steht nirgends.", source)

    expect(result.cleanedContent).toBe("Fakt  steht nirgends.")
    expect(result.citations).toEqual([])
    expect(result.validCount).toBe(0)
    expect(result.invalidCount).toBe(1)
  })

  it("[0] is invalid (n < 1) and is stripped", () => {
    const result = parseCitations("Siehe [0] dazu.", chunks(3))

    expect(result.cleanedContent).toBe("Siehe  dazu.")
    expect(result.citations).toEqual([])
    expect(result.invalidCount).toBe(1)
    expect(result.validCount).toBe(0)
  })

  it("adjacent markers [1][3] both resolve independently", () => {
    const source = chunks(3)
    const result = parseCitations("Zwei Quellen [1][3] stützen das.", source)

    expect(result.cleanedContent).toBe("Zwei Quellen [1][3] stützen das.")
    expect(result.citations).toEqual([
      { n: 1, chunk_id: "chunk-1", source_id: "source-1" },
      { n: 3, chunk_id: "chunk-3", source_id: "source-3" },
    ])
    expect(result.validCount).toBe(2)
    expect(result.invalidCount).toBe(0)
  })

  it("a marker at the very end of the string is handled", () => {
    const source = chunks(2)
    const result = parseCitations("Letzter Satz [1]", source)

    expect(result.cleanedContent).toBe("Letzter Satz [1]")
    expect(result.citations).toEqual([{ n: 1, chunk_id: "chunk-1", source_id: "source-1" }])
  })

  it("a hallucinated marker at the very end of the string is stripped cleanly", () => {
    const source = chunks(2)
    const result = parseCitations("Letzter Satz [5]", source)

    expect(result.cleanedContent).toBe("Letzter Satz ")
    expect(result.citations).toEqual([])
    expect(result.invalidCount).toBe(1)
  })

  it("multi-digit marker [12] is parsed as n=12, not truncated", () => {
    const source = chunks(12)
    const result = parseCitations("Beleg [12] hier.", source)

    expect(result.citations).toEqual([{ n: 12, chunk_id: "chunk-12", source_id: "source-12" }])
    expect(result.invalidCount).toBe(0)
  })

  it("multi-digit marker [12] beyond chunks.length is invalid", () => {
    const source = chunks(8)
    const result = parseCitations("Beleg [12] hier.", source)

    expect(result.citations).toEqual([])
    expect(result.invalidCount).toBe(1)
    expect(result.cleanedContent).toBe("Beleg  hier.")
  })

  it("dedupe: a repeated valid marker produces exactly one citation entry, both marker occurrences stay in the text", () => {
    const source = chunks(3)
    const result = parseCitations("Fakt A [2]. Verwandter Fakt [2] auch.", source)

    expect(result.citations).toEqual([{ n: 2, chunk_id: "chunk-2", source_id: "source-2" }])
    expect(result.validCount).toBe(1)
    expect(result.cleanedContent).toBe("Fakt A [2]. Verwandter Fakt [2] auch.")
  })

  it("citations are returned sorted by n ascending regardless of appearance order", () => {
    const source = chunks(3)
    const result = parseCitations("Erst [3], dann [1].", source)

    expect(result.citations).toEqual([
      { n: 1, chunk_id: "chunk-1", source_id: "source-1" },
      { n: 3, chunk_id: "chunk-3", source_id: "source-3" },
    ])
  })

  it("a mix of valid and invalid markers: cleanedContent keeps valid markers, strips invalid ones", () => {
    const source = chunks(2)
    const result = parseCitations("Valide [1], erfunden [7], nochmal valide [2].", source)

    expect(result.cleanedContent).toBe("Valide [1], erfunden , nochmal valide [2].")
    expect(result.citations).toEqual([
      { n: 1, chunk_id: "chunk-1", source_id: "source-1" },
      { n: 2, chunk_id: "chunk-2", source_id: "source-2" },
    ])
    expect(result.validCount).toBe(2)
    expect(result.invalidCount).toBe(1)
  })

  it("0 chunks retrieved: any marker is invalid (n > 0 = chunks.length always fails)", () => {
    const result = parseCitations("Zitat [1] trotz leerem Kontext.", [])

    expect(result.citations).toEqual([])
    expect(result.invalidCount).toBe(1)
    expect(result.cleanedContent).toBe("Zitat  trotz leerem Kontext.")
  })
})
