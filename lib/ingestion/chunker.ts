import { getEncoding } from "js-tiktoken"

/**
 * Pure text chunker (specs/02-ingestion.md §9, Eng-Review F6 — binding
 * algorithm contract). No I/O.
 *
 * NEVER use `decode(tokens.slice(a, b))` as `chunk.content`. cl100k_base is
 * a byte-level BPE tokenizer — a token boundary can split a multi-byte
 * character (umlaut, emoji, CJK) mid-byte-sequence, and decoding just that
 * slice then yields U+FFFD replacement characters with char offsets that
 * drift from the source text.
 *
 * Instead: character offsets for a candidate token boundary are found by
 * decoding the token *prefix* from a known-safe boundary forward, and
 * verified against the source text via a `text.slice(...) === prefix`
 * oracle. If decoding a boundary corrupts a multi-byte character (the
 * oracle fails), the boundary is snapped back one token at a time until it
 * holds. `chunk.content` is ALWAYS produced via `text.slice(charStart,
 * charEnd)` on the original string — never reconstructed from decoded
 * tokens — so the `content === text.slice(charStart, charEnd)` invariant
 * (AC-21) holds unconditionally, by construction, regardless of how
 * snapping played out.
 */

export interface Chunk {
  index: number
  content: string
  charStart: number
  charEnd: number
  tokenCount: number
}

export interface ChunkOptions {
  /** Target max tokens per chunk. Default 800 — a *target*, not a hard cap
   *  (Eng-Review OV3): boundary snapping can shave off up to ~1 token. */
  maxTokens?: number
  /** Target token overlap between consecutive chunks. Default 100 — same
   *  ±1-token snap tolerance as maxTokens. */
  overlapTokens?: number
}

const DEFAULT_MAX_TOKENS = 800
const DEFAULT_OVERLAP_TOKENS = 100

/**
 * Resolves the character offset for a token index, walking the boundary
 * back one token at a time until the decode(prefix) === text.slice(...)
 * oracle holds. Uses `cache` (a growing map of already-validated
 * tokenIdx -> charOffset boundaries) to decode only the *delta* since the
 * nearest known-safe predecessor, instead of re-decoding the whole prefix
 * from token 0 every time — this is what keeps the algorithm roughly
 * linear in the number of tokens instead of quadratic (Eng-Review F6,
 * "Offsets werden an Overlap-Grenzen gecacht").
 *
 * Termination is guaranteed: the predecessor boundary is itself already
 * validated-safe, and the empty delta at `tokenIdx === predecessorIdx`
 * always satisfies the oracle (`"" === ""`), so the backward walk cannot
 * run past it.
 */
function resolveTokenBoundary(
  tokens: number[],
  text: string,
  candidateIdx: number,
  cache: Map<number, number>,
  decode: (slice: number[]) => string
): { tokenIdx: number; charOffset: number } {
  const cached = cache.get(candidateIdx)
  if (cached !== undefined) {
    return { tokenIdx: candidateIdx, charOffset: cached }
  }

  let predecessorIdx = 0
  for (const key of cache.keys()) {
    if (key <= candidateIdx && key > predecessorIdx) predecessorIdx = key
  }
  const predecessorCharOffset = cache.get(predecessorIdx) ?? 0

  let tokenIdx = candidateIdx
  while (tokenIdx > predecessorIdx) {
    const delta = decode(tokens.slice(predecessorIdx, tokenIdx))
    const charOffset = predecessorCharOffset + delta.length
    if (text.slice(predecessorCharOffset, charOffset) === delta) {
      cache.set(tokenIdx, charOffset)
      return { tokenIdx, charOffset }
    }
    tokenIdx -= 1
  }

  // Fell back all the way to the predecessor boundary — always safe
  // (empty delta), guarantees the function terminates and returns.
  cache.set(predecessorIdx, predecessorCharOffset)
  return { tokenIdx: predecessorIdx, charOffset: predecessorCharOffset }
}

/**
 * Splits `text` into overlapping chunks of ~`maxTokens` cl100k_base tokens
 * each, with ~`overlapTokens` tokens of overlap between neighbors. Pure —
 * no I/O, no network. See module doc for the char-offset algorithm
 * contract.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS
  const overlapTokens = opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS

  if (text.length === 0) return []

  const encoding = getEncoding("cl100k_base")
  // `"all"` for allowedSpecial: ingested user/PDF/web content is arbitrary
  // prose that may incidentally contain special-token-looking substrings
  // (e.g. a technical document mentioning "<|endoftext|>") — encoding must
  // never throw on that, it should just tokenize it as ordinary text/specials.
  const tokens = encoding.encode(text, "all")
  const decode = (slice: number[]) => encoding.decode(slice)

  if (tokens.length <= maxTokens) {
    return [
      {
        index: 0,
        content: text,
        charStart: 0,
        charEnd: text.length,
        tokenCount: tokens.length,
      },
    ]
  }

  const cache = new Map<number, number>([[0, 0]])
  const chunks: Chunk[] = []
  let tokenStart = 0
  let index = 0
  // Circuit breaker only — real inputs never approach this; it exists so a
  // pathological/adversarial input fails loudly instead of hanging.
  const maxIterations = tokens.length + 8

  while (tokenStart < tokens.length && chunks.length < maxIterations) {
    const startBoundary = resolveTokenBoundary(
      tokens,
      text,
      tokenStart,
      cache,
      decode
    )

    const rawTokenEnd = Math.min(startBoundary.tokenIdx + maxTokens, tokens.length)

    let resolvedTokenEnd: number
    let charEnd: number
    if (rawTokenEnd >= tokens.length) {
      // Last chunk always ends exactly at text.length (AC-23) — no decode
      // needed, sidesteps any boundary-snap rounding entirely.
      resolvedTokenEnd = tokens.length
      charEnd = text.length
      cache.set(resolvedTokenEnd, charEnd)
    } else {
      const endBoundary = resolveTokenBoundary(
        tokens,
        text,
        rawTokenEnd,
        cache,
        decode
      )
      resolvedTokenEnd = endBoundary.tokenIdx
      charEnd = endBoundary.charOffset
    }

    chunks.push({
      index,
      content: text.slice(startBoundary.charOffset, charEnd),
      charStart: startBoundary.charOffset,
      charEnd,
      tokenCount: resolvedTokenEnd - startBoundary.tokenIdx,
    })

    if (resolvedTokenEnd >= tokens.length) break

    const nextRawStart = resolvedTokenEnd - overlapTokens
    // Guarantee forward progress even in a pathological snap-back case.
    tokenStart = Math.max(nextRawStart, startBoundary.tokenIdx + 1)
    index += 1
  }

  return chunks
}
