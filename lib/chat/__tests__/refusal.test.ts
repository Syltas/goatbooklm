import { describe, expect, it } from "vitest"

import { NO_COVERAGE_MESSAGE } from "../messages"
import { normalizeRefusal, type RefusalCheck } from "../refusal"

/** Mirrors `ChatService.isRefusal` (`lib/chat/service.ts`): exact,
 *  whitespace-normalized match against `NO_COVERAGE_MESSAGE`. Re-implemented
 *  here (not imported) so this module's tests stay independent of the
 *  Supabase-backed service. */
function realIsRefusal(content: string): boolean {
  return content.trim().replace(/\s+/g, " ") === NO_COVERAGE_MESSAGE
}

const service: RefusalCheck = { isRefusal: realIsRefusal }

describe("normalizeRefusal", () => {
  it("M1: a short cited sentence with high word-overlap against the refusal stays UNCHANGED (never touches text carrying a [n] marker)", () => {
    // Deliberately overlaps heavily with NO_COVERAGE_MESSAGE's wording, but
    // carries a real citation — this must never be collapsed into the gate
    // constant, or the citation (and the answer it belongs to) is lost.
    const cited = "Ihre Quellen enthalten dazu Informationen [1]."

    expect(normalizeRefusal(cited, service)).toBe(cited)
  })

  it("M1: a short cited sentence stays unchanged even when isRefusal() would (hypothetically) say true", () => {
    const alwaysRefusal: RefusalCheck = { isRefusal: () => true }
    const cited = "Der Umsatz stieg um 12% [2]."

    expect(normalizeRefusal(cited, alwaysRefusal)).toBe(cited)
  })

  it("M1: text with a hallucinated/out-of-range marker is still left untouched (presence, not validity, gates normalization)", () => {
    const cited = "Ihre Quellen enthalten dazu leider keine Informationen [99]."

    expect(normalizeRefusal(cited, service)).toBe(cited)
  })

  it("an exact match of the canonical refusal normalizes to the constant (identity, but exercises the isRefusal branch)", () => {
    expect(normalizeRefusal(NO_COVERAGE_MESSAGE, service)).toBe(NO_COVERAGE_MESSAGE)
  })

  it("a real paraphrased refusal WITHOUT any citation marker is normalized to the exact constant", () => {
    const paraphrase = "Dazu enthalten Ihre Quellen leider keine Informationen."

    expect(normalizeRefusal(paraphrase, service)).toBe(NO_COVERAGE_MESSAGE)
  })

  it("a substantive, uncited answer with low word-overlap is left unchanged", () => {
    const answer = "Der Bericht beschreibt drei Wachstumsphasen des Unternehmens."

    expect(normalizeRefusal(answer, service)).toBe(answer)
  })

  it("a long paraphrase (> 2x the constant's length) is left unchanged even without a marker", () => {
    const long =
      "Leider kann ich diese Frage nicht beantworten, da die von Ihnen bereitgestellten Quellen keinerlei Informationen zu diesem speziellen Thema enthalten, das Sie gerade angesprochen haben."

    expect(normalizeRefusal(long, service)).toBe(long)
  })

  it("an empty (or whitespace-only) string is returned as-is", () => {
    expect(normalizeRefusal("", service)).toBe("")
    expect(normalizeRefusal("   ", service)).toBe("   ")
  })

  it("leading/trailing whitespace around a marker-free paraphrase still normalizes (trimmed before comparison)", () => {
    const paraphrase = "  Dazu enthalten Ihre Quellen leider keine Informationen.  "

    expect(normalizeRefusal(paraphrase, service)).toBe(NO_COVERAGE_MESSAGE)
  })
})
