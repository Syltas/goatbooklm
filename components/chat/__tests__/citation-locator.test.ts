import { describe, expect, it } from "vitest"

import type { CitationDetail } from "@/lib/chat/types"

import { formatLocator } from "../citation-locator"

function citation(overrides: Partial<CitationDetail> = {}): CitationDetail {
  return {
    n: 1,
    chunkId: "chunk-1",
    sourceId: "source-1",
    sourceTitle: "Titel",
    sourceType: "text",
    content: "Inhalt",
    ...overrides,
  }
}

describe("formatLocator", () => {
  it("combines page + paragraph for a paginated source (PDF)", () => {
    expect(formatLocator(citation({ page: 2, paragraph: 1 }))).toBe("Seite 2 · Absatz 1")
  })

  it("degrades to paragraph-only when there is no page — never 'Seite undefined' (AC-53)", () => {
    expect(formatLocator(citation({ paragraph: 4 }))).toBe("Absatz 4")
  })

  it("degrades to page-only when there is no paragraph", () => {
    expect(formatLocator(citation({ page: 7 }))).toBe("Seite 7")
  })

  it("returns null (renders nothing) when neither is available", () => {
    expect(formatLocator(citation())).toBeNull()
  })
})
