import { openai } from "@ai-sdk/openai"
import { embedMany } from "ai"
import type { EmbeddingModel } from "ai"

/**
 * Embeds chunk texts via a single `embedMany` call (Eng-Review F7,
 * specs/02-ingestion.md §9). No manual 100-item batching: `embedMany`
 * already splits internally per the model's `maxEmbeddingsPerCall` (OpenAI:
 * 2048). `maxParallelCalls: 5` caps concurrent requests — the SDK default
 * is `Infinity`, which would fire every internal batch at once and blow
 * through OpenAI rate limits for a source with many chunks.
 *
 * The model instance is an injectable dependency (not module-level state)
 * so tests can stub it without hitting the real OpenAI API — see
 * `createEmbedChunks`.
 */
export function createEmbedChunks(
  model: EmbeddingModel = openai.textEmbeddingModel("text-embedding-3-small")
) {
  return async function embedChunks(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const { embeddings } = await embedMany({
      model,
      values: texts,
      maxParallelCalls: 5,
    })

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
