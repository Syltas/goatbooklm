import { openai } from "@ai-sdk/openai"
import { embedMany } from "ai"
import type { EmbeddingModel } from "ai"
import { getEncoding } from "js-tiktoken"

/**
 * OpenAI's `/embeddings` endpoint rejects any single request that its
 * per-request size pre-check estimates at over 300k tokens (HTTP 400). The AI
 * SDK's `embedMany` only splits `values` by item count (the model's
 * `maxEmbeddingsPerCall`, 2048 for OpenAI) — never by request size — so a
 * large source lands in one oversized request and fails at embedding while
 * smaller sources succeed. This is the root cause of "several uploads fail at
 * embedding": it is size-dependent, not a key/quota problem.
 *
 * Two non-obvious facts, both measured against the live API, drive how we
 * budget a batch:
 *  1. OpenAI's *billing* token count (`usage.prompt_tokens`) is the exact sum
 *     of each input's real cl100k_base tokens — no per-input overhead.
 *  2. OpenAI's per-request *limit* pre-check does NOT use that real count. It
 *     over-estimates as roughly `chars / 4` per input: an 802-token chunk of
 *     4320 chars was rejected as 1080 "tokens" (== ceil(4320/4)), while a
 *     19-token/68-char chunk was counted at its true 19. The pre-check binds
 *     on whichever is larger, so text with a high chars-per-token ratio
 *     (repetitive/ASCII/some German prose) can trip the 300k limit well below
 *     300k *real* tokens.
 *
 * So we budget each batch on `max(realTokens, ceil(chars/4))` per input and
 * keep the batch sum under a margin below 300k. Batches run sequentially and
 * embeddings are concatenated in the original chunk order, so `embeddings[i]`
 * still corresponds to `texts[i]` (the caller in `service.ts` zips them back
 * to chunks positionally).
 */
const MAX_REQUEST_UNITS = 240_000
const MAX_ITEMS_PER_REQUEST = 2048

/**
 * The size one input contributes to OpenAI's per-request limit pre-check:
 * the larger of its real cl100k_base token count and its `ceil(chars/4)`
 * estimate (see fact 2 in the module doc). This is an upper bound on the true
 * token cost, so budgeting on it never under-counts a request.
 */
function requestUnits(text: string, tokenCount: number): number {
  return Math.max(tokenCount, Math.ceil(text.length / 4))
}

/**
 * Greedily packs `texts` into batches, each ≤ `MAX_REQUEST_UNITS` request
 * units and ≤ `MAX_ITEMS_PER_REQUEST` items. Order is preserved: a batch
 * boundary is only ever opened before appending the next text, never by
 * reordering. A single text is never split — the chunker already caps each
 * chunk at ~800 tokens, far below any per-request limit — so a lone
 * over-budget text (which cannot occur for real chunked content) still goes
 * out as its own batch rather than being dropped.
 */
export function batchForEmbedding(texts: string[]): string[][] {
  const encoding = getEncoding("cl100k_base")
  const batches: string[][] = []
  let current: string[] = []
  let currentUnits = 0

  for (const text of texts) {
    const units = requestUnits(text, encoding.encode(text, "all").length)
    const startsNewBatch =
      current.length > 0 &&
      (currentUnits + units > MAX_REQUEST_UNITS ||
        current.length >= MAX_ITEMS_PER_REQUEST)

    if (startsNewBatch) {
      batches.push(current)
      current = []
      currentUnits = 0
    }

    current.push(text)
    currentUnits += units
  }

  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Embeds chunk texts via `embedMany`, one call per size-budgeted batch (see
 * `batchForEmbedding`). `maxParallelCalls: 5` caps concurrency for the case
 * where a single batch still holds enough items for the SDK to fan out
 * internally; the SDK default is `Infinity`, which would fire every internal
 * request at once and risk OpenAI rate limits.
 *
 * The model instance is an injectable dependency (not module-level state) so
 * tests can stub it without hitting the real OpenAI API — see
 * `createEmbedChunks`.
 */
export function createEmbedChunks(
  model: EmbeddingModel = openai.textEmbeddingModel("text-embedding-3-small")
) {
  return async function embedChunks(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const batches = batchForEmbedding(texts)
    const embeddings: number[][] = []

    for (const batch of batches) {
      const { embeddings: batchEmbeddings } = await embedMany({
        model,
        values: batch,
        maxParallelCalls: 5,
      })
      embeddings.push(...batchEmbeddings)
    }

    return embeddings
  }
}

/**
 * Default, production-wired `embedChunks` — uses the real OpenAI
 * `text-embedding-3-small` model. Callers that need to stub embedding in
 * tests should use `createEmbedChunks(fakeModel)` instead and inject the
 * result into `IngestionDeps.embedChunks`.
 */
export const embedChunks = createEmbedChunks()
