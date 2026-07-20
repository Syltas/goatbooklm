import { describe, expect, it } from "vitest"

import { readChunkOffsets } from "../types"

describe("readChunkOffsets", () => {
  it("returns char_start/char_end/page when all three are present ints", () => {
    expect(readChunkOffsets({ char_start: 10, char_end: 20, page: 3 })).toEqual({
      charStart: 10,
      charEnd: 20,
      page: 3,
    })
  })

  it("degrades page to undefined for a non-paginated source (web/text/note) — AC-53", () => {
    // `buildChunkMetadata` (lib/ingestion/service.ts) never writes `page` for
    // formats without page offsets — this is what the citation-popover
    // locator's "Seite X · Absatz Y" -> "Absatz Y" degrade depends on.
    expect(readChunkOffsets({ char_start: 0, char_end: 5 })).toEqual({
      charStart: 0,
      charEnd: 5,
      page: undefined,
    })
  })

  it("ignores a non-numeric page instead of throwing or coercing", () => {
    expect(readChunkOffsets({ char_start: 0, char_end: 5, page: "3" })).toEqual({
      charStart: 0,
      charEnd: 5,
      page: undefined,
    })
  })

  it("returns {} for missing/malformed metadata (AC-G4 graceful degrade)", () => {
    expect(readChunkOffsets(null)).toEqual({})
    expect(readChunkOffsets(undefined)).toEqual({})
    expect(readChunkOffsets("not-an-object")).toEqual({})
    expect(readChunkOffsets(["array", "not", "object"])).toEqual({})
  })
})
