import { getEncoding } from "js-tiktoken"
import { describe, expect, it } from "vitest"

import { chunkText } from "../chunker"

const encoding = getEncoding("cl100k_base")
const tokenCount = (s: string) => encoding.encode(s, "all").length

/** Repeats a unit string until the combined text exceeds `minTokens`. */
function buildText(unit: string, minTokens: number): string {
  let text = ""
  while (tokenCount(text) < minTokens) text += unit
  return text
}

/**
 * Property-check shared by every test below (Eng-Review F6 regression
 * guard): every chunk's content must be an exact char-slice of the source
 * text — never a decoded-token reconstruction — and chunks must not leave
 * gaps (each chunk starts at or before the previous chunk's end).
 */
function assertInvariants(text: string, chunks: ReturnType<typeof chunkText>) {
  expect(chunks.length).toBeGreaterThan(0)

  for (const chunk of chunks) {
    expect(chunk.content).toBe(text.slice(chunk.charStart, chunk.charEnd))
    expect(chunk.charEnd).toBeGreaterThan(chunk.charStart)
    // Chunk content must never start/end mid-surrogate-pair — a direct
    // regression check against `decode(tokens.slice(...))` corruption.
    expect(isLoneSurrogate(chunk.content, 0)).toBe(false)
    expect(isLoneSurrogate(chunk.content, chunk.content.length - 1)).toBe(
      false
    )
  }

  for (let i = 1; i < chunks.length; i++) {
    expect(chunks[i].charStart).toBeLessThanOrEqual(chunks[i - 1].charEnd)
    expect(chunks[i].index).toBe(chunks[i - 1].index + 1)
  }

  expect(chunks[0].charStart).toBe(0)
  expect(chunks[chunks.length - 1].charEnd).toBe(text.length)
}

function isLoneSurrogate(s: string, index: number): boolean {
  if (index < 0 || index >= s.length) return false
  const code = s.charCodeAt(index)
  const isHigh = code >= 0xd800 && code <= 0xdbff
  const isLow = code >= 0xdc00 && code <= 0xdfff
  if (isHigh) return index === s.length - 1 || !isLowSurrogateAt(s, index + 1)
  if (isLow) return index === 0 || !isHighSurrogateAt(s, index - 1)
  return false
}
function isLowSurrogateAt(s: string, i: number) {
  const c = s.charCodeAt(i)
  return c >= 0xdc00 && c <= 0xdfff
}
function isHighSurrogateAt(s: string, i: number) {
  const c = s.charCodeAt(i)
  return c >= 0xd800 && c <= 0xdbff
}

describe("chunkText", () => {
  it("AC-22: a text under 800 tokens returns exactly one chunk with the full text", () => {
    const text = "Dies ist ein kurzer Testtext für das Notebook."
    const chunks = chunkText(text)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      index: 0,
      content: text,
      charStart: 0,
      charEnd: text.length,
    })
    expect(chunks[0].tokenCount).toBeLessThan(800)
  })

  it("handles the empty string as zero chunks", () => {
    expect(chunkText("")).toEqual([])
  })

  it("AC-19/AC-20/AC-21/AC-23: long text — target token size, ~100-token overlap, exact char-offset invariant, last chunk ends at text.length", () => {
    const text = buildText(
      "Die Ingestion-Pipeline zerlegt lange Dokumente in überlappende Abschnitte, damit spätere Zitate exakte Zeichen-Offsets referenzieren können. ",
      3000
    )
    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(3)
    assertInvariants(text, chunks)

    for (const chunk of chunks.slice(0, -1)) {
      // Target 800, ±1 boundary-snap tolerance (Eng-Review OV3).
      expect(chunk.tokenCount).toBeLessThanOrEqual(800)
      expect(chunk.tokenCount).toBeGreaterThan(700)
    }

    for (let i = 1; i < chunks.length; i++) {
      const overlapChars = chunks[i - 1].charEnd - chunks[i].charStart
      expect(overlapChars).toBeGreaterThan(0)
      const overlapText = text.slice(chunks[i].charStart, chunks[i - 1].charEnd)
      const overlapTokens = tokenCount(overlapText)
      // ~100 tokens target, generous tolerance for BPE re-tokenization
      // effects at an isolated substring's edges.
      expect(overlapTokens).toBeGreaterThan(80)
      expect(overlapTokens).toBeLessThan(120)
    }
  })

  it("uses custom maxTokens/overlapTokens options", () => {
    const text = buildText("Kurzes Wort. ", 500)
    const chunks = chunkText(text, { maxTokens: 50, overlapTokens: 10 })

    expect(chunks.length).toBeGreaterThan(5)
    assertInvariants(text, chunks)
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(50)
    }
  })

  it("holds the char-offset invariant for German text dense with umlauts/ß", () => {
    const text = buildText(
      "Grüße aus München: Straßenbahnfahrpläne für Übermorgen ändern sich häufig, größtenteils wegen Baustellen in der Fußgängerzone. ",
      2500
    )
    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(2)
    assertInvariants(text, chunks)
  })

  it("holds the char-offset invariant with emoji packed tightly enough to force a boundary through one (regression: decode(tokens.slice) corruption)", () => {
    // Emoji every few characters, small maxTokens/overlap so chunk
    // boundaries fall densely throughout the text — this all but
    // guarantees at least one raw token boundary lands inside a
    // surrogate-pair emoji, exercising the boundary-snap path for real.
    const unit = "a🎉b🚀c✨d🔥e🌍f"
    const text = buildText(unit, 1500)
    const chunks = chunkText(text, { maxTokens: 30, overlapTokens: 8 })

    expect(chunks.length).toBeGreaterThan(10)
    assertInvariants(text, chunks)

    // Sanity: the text really does contain emoji as full surrogate pairs.
    expect(text.codePointAt(1)).toBeGreaterThan(0xffff)
  })

  it("holds the char-offset invariant for CJK text", () => {
    const text = buildText(
      "これは日本語のテストテキストです。長い文章を分割してもオフセットが正確であることを確認します。中文测试文本也应该正确处理。",
      2500
    )
    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(2)
    assertInvariants(text, chunks)
  })

  it("produces sequential, zero-based chunk indices", () => {
    const text = buildText("Wiederholter Absatz für Chunk-Tests. ", 3000)
    const chunks = chunkText(text)

    chunks.forEach((chunk, i) => expect(chunk.index).toBe(i))
  })
})
