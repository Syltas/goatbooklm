import type { Citation, ParsedCitations, RetrievedChunk } from "./types"

/** Matches every `[n]`-style marker where `n` is one or more digits — the
 *  literal `[\d+]` grammar from specs/03-chat-grounding.md §4 Schicht 3.
 *  Note this deliberately does NOT match a leading `-` (e.g. `[-1]`): such a
 *  marker is not a `[\d+]` pattern at all per the spec's own definition, so
 *  it is left untouched in the text, not counted as invalid. */
const CITATION_MARKER = /\[(\d+)\]/g

/**
 * Grounding-Guardrail Schicht 3 — Post-Validation (specs/03-chat-grounding.md
 * §4 Schicht 3, DE-3). Scans `fullText` for every `[n]` marker against the
 * `chunks` that were actually retrieved for this turn:
 *
 * - `1 <= n <= chunks.length` → valid. A `Citation` entry is recorded
 *   (deduped per distinct `n` — a marker repeated in the text, e.g. two
 *   `[2]`s, produces one citation entry) and the marker itself is left in
 *   the text unchanged, every occurrence.
 * - otherwise (n < 1, or n > chunks.length — hallucinated) → invalid. The
 *   marker substring is removed from the text (DE-3: a citation pointing
 *   nowhere is worse than none, and a dead/non-clickable chip invites
 *   failed clicks) and `invalidCount` is incremented for every such
 *   occurrence — this is a logged quality signal, not persisted data, so it
 *   is not deduped.
 *
 * `citations` is returned sorted by `n` ascending. `validCount` is
 * `citations.length` (the count of distinct valid `n`s).
 */
export function parseCitations(
  fullText: string,
  chunks: RetrievedChunk[]
): ParsedCitations {
  const citationsByN = new Map<number, Citation>()
  let invalidCount = 0

  const cleanedContent = fullText.replace(CITATION_MARKER, (marker, digits: string) => {
    const n = Number(digits)

    if (n >= 1 && n <= chunks.length) {
      if (!citationsByN.has(n)) {
        const chunk = chunks[n - 1]
        citationsByN.set(n, { n, chunk_id: chunk.chunkId, source_id: chunk.sourceId })
      }
      return marker
    }

    invalidCount++
    return ""
  })

  const citations = [...citationsByN.values()].sort((a, b) => a.n - b.n)

  return {
    cleanedContent,
    citations,
    invalidCount,
    validCount: citations.length,
  }
}
