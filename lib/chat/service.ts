import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Json } from "@/lib/database.types"

import { NO_COVERAGE_MESSAGE } from "./prompt"
import type { ChatMessage, ChatRole, Citation, RetrievedChunk } from "./types"

type Message = Database["public"]["Tables"]["messages"]["Row"]

/**
 * Gate/retrieval tuning knobs (specs §3.3, §5 "Service-Deps"). Deliberately
 * a plain required struct with no defaults baked into this module: reading
 * `process.env.CHAT_MIN_SIMILARITY` (or any env var) happens ONLY at the
 * composition site that calls `createChatService` (e.g. the route handler),
 * never inside this pure service — see task boundary / DoD-Pure-Service.
 */
export interface ChatServiceConfig {
  /** `p_match_count` — retrieval top-k (spec default: 8). */
  topK: number
  /** `p_min_similarity` — cosine-similarity cutoff (spec default: 0.35,
   *  overridable via env `CHAT_MIN_SIMILARITY` at the composition site). */
  minSimilarity: number
  /** Number of most-recent `messages` rows `loadHistory` returns (spec
   *  default: 6 = last 3 turns). */
  historyWindow: number
}

/**
 * Dependencies injected into the chat service — the Supabase client plus
 * the query-embedding function. Neither is imported directly by this
 * module, so it runs identically from a Route Handler or a test with stubs
 * (service-builder pattern, mirrors `lib/auth/service.ts` /
 * `lib/ingestion/service.ts`).
 */
export interface ChatServiceDeps {
  /** Request-scoped Supabase client (RLS applies) — never the admin client. */
  db: SupabaseClient<Database>
  /** `(text) => Promise<number[]>` — production wiring is
   *  `(text) => embedQuery(defaultQueryEmbeddingModel, text)` from
   *  `lib/embeddings/client.ts`, composed at the route handler. */
  embed: (text: string) => Promise<number[]>
  config: ChatServiceConfig
}

export function createChatService(deps: ChatServiceDeps) {
  return new ChatService(deps)
}

class ChatService {
  private readonly client: SupabaseClient<Database>
  private readonly config: ChatServiceConfig

  constructor(private readonly deps: ChatServiceDeps) {
    this.client = deps.db
    this.config = deps.config
  }

  // ---------------------------------------------------------------------
  // Schicht 2 — Retrieval-Gate building blocks (specs §3.2 steps 2, 5, 7–8)
  // ---------------------------------------------------------------------

  /**
   * Owner-check (specs §3.2 step 2). RLS already scopes `notebooks` rows to
   * their owner, so a `notebookId` that belongs to another user and one
   * that doesn't exist at all both resolve to `null` here identically —
   * the same fail-closed 404 either way at the route layer (mirrors
   * `getOwnedSource`'s reasoning in `lib/ingestion/service.ts`).
   */
  async assertNotebookOwned(notebookId: string): Promise<{ id: string } | null> {
    const { data, error } = await this.client
      .from("notebooks")
      .select("id")
      .eq("id", notebookId)
      .maybeSingle()

    if (error) throw error
    return data
  }

  /** Guard 2a (specs §4 Schicht 2): 0 `ready` sources ⇒ the route must
   *  refuse with `NO_SOURCES_MESSAGE` before any embedding/LLM call. */
  async countReadySources(notebookId: string): Promise<number> {
    const { count, error } = await this.client
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("notebook_id", notebookId)
      .eq("status", "ready")

    if (error) throw error
    return count ?? 0
  }

  /**
   * Last `config.historyWindow` messages, returned oldest→newest (specs §3.2
   * step 4, OV4). Queries `created_at desc limit N` — the cheapest way to
   * get the *most recent* N rows — then reverses in memory so callers get
   * chronological order for `streamText({ messages })`.
   */
  async loadHistory(notebookId: string): Promise<ChatMessage[]> {
    const { data, error } = await this.client
      .from("messages")
      .select("role, content")
      .eq("notebook_id", notebookId)
      .order("created_at", { ascending: false })
      .limit(this.config.historyWindow)

    if (error) throw error

    return (data ?? [])
      .slice()
      .reverse()
      .map((row) => ({ role: row.role as ChatRole, content: row.content }))
  }

  /** Delegates to the injected `embed` dependency (specs §3.2 step 6, §5
   *  file-structure comment ".embedQuery()"). Kept as a thin service method
   *  — rather than inlining `deps.embed(text)` at call sites — so the whole
   *  retrieval pipeline (embed → retrieve) can be driven through the same
   *  `ChatService` instance. */
  async embedQuery(text: string): Promise<number[]> {
    return this.deps.embed(text)
  }

  /**
   * Vector retrieval via the `match_chunks` RPC (specs §3.2 step 7, §3.4
   * Contract 1) — runs on the request-scoped `db` client so RLS filters to
   * the caller's own chunks (defense in depth alongside the owner check in
   * `assertNotebookOwned`; a foreign `notebookId` yields 0 rows, never
   * another user's chunks). Param names match the RPC signature exactly:
   * `p_notebook_id`, `p_query_embedding`, `p_match_count`,
   * `p_min_similarity`. `queryEmbedding` is serialized to pgvector's text
   * wire format (`[v1,v2,...]`) before being sent, mirroring
   * `lib/ingestion/service.ts`'s `toPgVector` for the same reason (the
   * Postgres `vector` type has no direct JSON-array cast).
   */
  async retrieve(notebookId: string, queryEmbedding: number[]): Promise<RetrievedChunk[]> {
    const { data, error } = await this.client.rpc("match_chunks", {
      p_notebook_id: notebookId,
      p_query_embedding: toPgVector(queryEmbedding),
      p_match_count: this.config.topK,
      p_min_similarity: this.config.minSimilarity,
    })

    if (error) throw error

    return (data ?? []).map((row) => ({
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      content: row.content,
      chunkIndex: row.chunk_index,
      similarity: row.similarity,
      metadata: row.metadata,
    }))
  }

  /**
   * Doc-level retrieval via `match_source_summaries` (chat-retrieval-rerank
   * Phase 1) — the summary counterpart to `retrieve`. Returns the top-`count`
   * per-doc summaries by cosine (NO similarity gate), shaped as `RetrievedChunk`
   * so the route merges them into one candidate pool with chunk hits.
   * `chunkId`/`chunkIndex` are `null` (a summary has no `chunks` row) and
   * `metadata` is `{}` (whole-doc overview, no page/char offsets) — both are
   * the discriminators the citation/hydrate path keys on for a summary.
   */
  async retrieveSummaries(
    notebookId: string,
    queryEmbedding: number[],
    count: number
  ): Promise<RetrievedChunk[]> {
    const { data, error } = await this.client.rpc("match_source_summaries", {
      p_notebook_id: notebookId,
      p_query_embedding: toPgVector(queryEmbedding),
      p_match_count: count,
    })

    if (error) throw error

    return (data ?? [])
      .filter((row): row is typeof row & { summary: string } =>
        typeof row.summary === "string" && row.summary.trim().length > 0
      )
      .map((row) => ({
        chunkId: null,
        sourceId: row.source_id,
        content: row.summary,
        chunkIndex: null,
        similarity: row.similarity,
        metadata: {},
      }))
  }

  // ---------------------------------------------------------------------
  // Persistenz (specs §8, DE-7)
  // ---------------------------------------------------------------------

  /**
   * Atomic turn persistence: the user row is inserted first, then the
   * assistant row — guarantees monotone `created_at` (read order is
   * `created_at asc`) and, since both inserts happen together right before
   * returning, that a mid-pipeline failure never leaves an orphaned user
   * question without its answer (DE-7). `userId` must always be the
   * server-resolved id from `getUser()` — this method trusts whatever is
   * passed in, so callers must never forward a client-supplied id
   * (DoD-Auth is the caller's responsibility here, not this method's).
   */
  async persistTurn(input: {
    notebookId: string
    userId: string
    question: string
    assistantContent: string
    citations: Citation[]
  }): Promise<{ userMessage: Message; assistantMessage: Message }> {
    const { data: userMessage, error: userError } = await this.client
      .from("messages")
      .insert({
        notebook_id: input.notebookId,
        user_id: input.userId,
        role: "user",
        content: input.question,
      })
      .select()
      .single()

    if (userError) throw userError

    const { data: assistantMessage, error: assistantError } = await this.client
      .from("messages")
      .insert({
        notebook_id: input.notebookId,
        user_id: input.userId,
        role: "assistant",
        content: input.assistantContent,
        citations: input.citations as unknown as Json,
      })
      .select()
      .single()

    if (assistantError) throw assistantError

    return { userMessage, assistantMessage }
  }

  // ---------------------------------------------------------------------
  // Schicht 3 — Badge-Regel input (specs §4 Schicht 3, DE-5/OV11)
  // ---------------------------------------------------------------------

  /**
   * Whether `content` is the canonical gate refusal — trimmed and
   * whitespace-collapsed before an exact comparison against
   * `NO_COVERAGE_MESSAGE`, so incidental formatting differences (trailing
   * newline, doubled spaces) don't cause a false negative. This is an EXACT
   * match after normalization, not a fuzzy/near-match comparison — see this
   * file's module boundary note in the task report regarding OV11's fuller
   * "paraphrase similarity" ask, which is intentionally NOT implemented
   * here (left to the route agent / a follow-up, since it requires a
   * similarity heuristic, not a pure string comparison).
   *
   * Used for the Ungrounded-Badge render rule (client-side, DE-5):
   * `content !== NO_COVERAGE_MESSAGE && citations.length === 0` — this
   * method is the canonical way to evaluate the left-hand side
   * server-side/in tests without duplicating the normalization logic.
   */
  isRefusal(content: string): boolean {
    return normalizeForComparison(content) === normalizeForComparison(NO_COVERAGE_MESSAGE)
  }
}

/**
 * History mutations need nothing but the Supabase client — no query
 * embedding, no retrieval tuning. Giving them their own factory keeps
 * `ChatServiceDeps` honest: a caller that only wants to clear the transcript
 * shouldn't have to invent an `embed` function and a `topK` it will never
 * use just to satisfy `createChatService`.
 */
export function createChatHistoryService(db: SupabaseClient<Database>) {
  return {
    /**
     * Owner-check, identical in spirit to `ChatService.assertNotebookOwned`:
     * RLS scopes `notebooks` to their owner, so "belongs to someone else" and
     * "does not exist" are indistinguishable here — both return `null` and
     * both must fail closed at the call site.
     */
    async assertNotebookOwned(notebookId: string): Promise<{ id: string } | null> {
      const { data, error } = await db
        .from("notebooks")
        .select("id")
        .eq("id", notebookId)
        .maybeSingle()

      if (error) throw error
      return data
    },

    /**
     * Deletes every message of one notebook and returns how many rows went.
     * The `user_id` filter is defense in depth — the `messages_owner` RLS
     * policy already makes a cross-user delete impossible — and `userId` must
     * be the server-resolved id from `getUser()`, never a client-supplied one.
     */
    async deleteHistory(notebookId: string, userId: string): Promise<number> {
      const { count, error } = await db
        .from("messages")
        .delete({ count: "exact" })
        .eq("notebook_id", notebookId)
        .eq("user_id", userId)

      if (error) throw error
      return count ?? 0
    },
  }
}

function normalizeForComparison(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

/** pgvector's text input format: `[v1,v2,...]` — see
 *  `lib/ingestion/service.ts`'s `toPgVector` for the insert-time twin of
 *  this helper (duplicated rather than imported/exported across modules for
 *  such a small, self-contained format function). */
function toPgVector(values: number[]): string {
  return `[${values.join(",")}]`
}
