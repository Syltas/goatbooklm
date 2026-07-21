import { describe, expect, it } from "vitest"

import { sanitizeUnicode } from "../sanitize"

describe("sanitizeUnicode", () => {
  it("replaces U+0000 with U+FFFD (Postgres cannot store null bytes in text/jsonb)", () => {
    expect(sanitizeUnicode("Vor\u0000Nach")).toBe("Vor�Nach")
    expect(sanitizeUnicode("\u0000\u0000")).toBe("��")
  })

  it("replaces lone surrogates but leaves well-formed surrogate pairs intact", () => {
    // Lone high surrogate, lone low surrogate — both rejected by Postgres.
    expect(sanitizeUnicode("a\uD800b")).toBe("a�b")
    expect(sanitizeUnicode("a\uDC00b")).toBe("a�b")
    // A real emoji is a valid high+low pair and must survive unchanged.
    expect(sanitizeUnicode("Katze 🐱!")).toBe("Katze 🐱!")
  })

  it("is length-preserving — chunk char offsets and pageOffsets depend on it", () => {
    const dirty = "Seite 1\u0000\n\nSeite\uD800 2"
    expect(sanitizeUnicode(dirty)).toHaveLength(dirty.length)
  })

  it("leaves clean text (umlauts, newlines, tabs) untouched", () => {
    const clean = "Größere Dateien.\n\tMit Tabs & Umlauten: äöüß."
    expect(sanitizeUnicode(clean)).toBe(clean)
  })
})
