import { openai } from "@ai-sdk/openai"
import { embed } from "ai"
import type { EmbeddingModel } from "ai"

/**
 * Default, production-wired query-embedding model — OpenAI
 * `text-embedding-3-small`, 1536 dimensions (matches `chunks.embedding
 * vector(1536)` and the ingestion pipeline's chunk embeddings, see
 * `lib/ingestion/embed.ts`). Only ever referenced at a composition site
 * (e.g. the chat route handler wiring `ChatServiceDeps.embed`); never
 * imported directly by `lib/chat/service.ts` itself, so the service stays
 * unit-testable without a real OpenAI call.
 */
export const defaultQueryEmbeddingModel: EmbeddingModel = openai.textEmbeddingModel(
  "text-embedding-3-small"
)

/**
 * Embeds a single query string via the AI SDK's `embed` (specs/03-chat-grounding.md
 * §3.2 step 6) — deliberately `embed`, not `embedMany`: exactly one query
 * per chat turn, no batching concern here (contrast with
 * `lib/ingestion/embed.ts`'s `embedChunks`, which embeds many chunk texts at
 * once). `model` is an injected argument, never a module-level singleton
 * call site, so callers can pass a stub in tests.
 */
export async function embedQuery(model: EmbeddingModel, text: string): Promise<number[]> {
  const { embedding } = await embed({ model, value: text })
  return embedding
}
