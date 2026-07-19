import { NO_COVERAGE_MESSAGE } from "./messages"

/**
 * Matches the presence of ANY `[n]`-style citation marker — the same
 * `[\d+]` grammar `parseCitations` (`lib/chat/citations.ts`) validates,
 * intentionally re-declared as an independent literal here rather than
 * imported: this check only needs "does a marker exist anywhere in the raw
 * text", not per-marker validity, so it stays a plain (non-global,
 * stateless) regex.
 */
const HAS_CITATION_MARKER = /\[\d+\]/

/**
 * Minimal shape `normalizeRefusal` needs from the chat service — just
 * `isRefusal`, so this module (and its tests) never has to construct a real
 * `ChatService`/Supabase client.
 */
export interface RefusalCheck {
  isRefusal: (content: string) => boolean
}

/**
 * OV11 hardening: `service.isRefusal` (`lib/chat/service.ts`) only does an
 * exact, whitespace-normalized match against `NO_COVERAGE_MESSAGE` — by
 * design (see that method's docstring), leaving a fuzzier "the model
 * paraphrased the refusal instead of reproducing it verbatim" heuristic to
 * this composition site. A short response with high word-overlap against
 * the canonical refusal is normalized to the exact constant BEFORE
 * `parseCitations` runs, so the Badge-Regel (DE-5, client-side) always
 * compares against one deterministic string, never raw, possibly-paraphrased
 * model output.
 *
 * Review-Fix M1 (Commit-Gate): a genuine refusal, per `GROUNDING_SYSTEM_PROMPT`
 * rule 3, is EXACTLY the canonical sentence and nothing else — it can never
 * legitimately carry an inline `[n]` citation, valid or hallucinated. So if
 * the RAW text contains any `[\d+]` marker at all, this is a real (partial)
 * cited answer, not a refusal, and normalization must leave it completely
 * untouched — even if it happens to be short and word-overlap-similar to the
 * refusal sentence (e.g. a correctly-cited one-liner that mentions "keine
 * Informationen" for an unrelated reason). This check runs BEFORE the
 * exact-match/word-overlap checks below, so it can't be short-circuited by
 * either of them.
 */
export function normalizeRefusal(text: string, service: RefusalCheck): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return text
  if (HAS_CITATION_MARKER.test(trimmed)) return text

  if (service.isRefusal(trimmed)) return NO_COVERAGE_MESSAGE

  if (trimmed.length <= NO_COVERAGE_MESSAGE.length * 2 && wordOverlap(trimmed, NO_COVERAGE_MESSAGE) >= 0.6) {
    return NO_COVERAGE_MESSAGE
  }

  return text
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().match(/\p{L}+/gu) ?? [])
  const wordsB = new Set(b.toLowerCase().match(/\p{L}+/gu) ?? [])
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let shared = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) shared++
  }
  return shared / Math.max(wordsA.size, wordsB.size)
}
