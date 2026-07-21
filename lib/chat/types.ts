import type { Json } from "@/lib/database.types"

/**
 * A chunk returned by the `match_chunks` RPC (specs/03-chat-grounding.md
 * §3.4 Contract 1), camelCased for TS-side use. `retrieve()`
 * (`lib/chat/service.ts`) maps the RPC's snake_case row 1:1 into this shape
 * — it never carries a `title`, since `match_chunks` does not select one
 * from `sources`. Callers that build the `<sources>` prompt block
 * (`buildSourceBlock`/`buildUserTurn`, `lib/chat/prompt.ts`) need a title
 * per chunk too — see `PromptChunk` below for that enriched shape and its
 * docstring for who is responsible for attaching it.
 */
export interface RetrievedChunk {
  /**
   * The `chunks` row id — or `null` for a doc-level SUMMARY candidate
   * (chat-retrieval-rerank Phase 1, multi-granularity retrieval). A summary
   * lives on `sources` (`summary`/`summary_embedding`), not in `chunks`, so it
   * has no chunk id. `null` (never a synthetic string) is the discriminator
   * everywhere downstream — a non-UUID sentinel would crash `hydrate.ts`'s
   * `.in("id", …)` against the `uuid` `chunks.id` on reload.
   */
  chunkId: string | null
  sourceId: string
  content: string
  /** `chunks.chunk_index`, or `null` for a summary candidate (no chunk
   *  sequence position — the locator's "Absatz N" is omitted for it). */
  chunkIndex: number | null
  similarity: number
  metadata: Json
}

/**
 * A `RetrievedChunk` enriched with its source's title — the shape
 * `buildSourceBlock`/`buildUserTurn` (`lib/chat/prompt.ts`) need to render
 * the `<source index="n" source_id="…" title="…">` tag (specs/03-chat-grounding.md
 * §4 Schicht 1). `match_chunks` does not return a title column, so `title`
 * is NOT part of `RetrievedChunk`/`ChatService.retrieve()`'s return value —
 * the composition site (the route handler that wires `lib/chat/service.ts`
 * together with `lib/chat/prompt.ts`) is responsible for joining each
 * chunk's `sourceId` against `sources.title` (e.g. one `select id, title
 * from sources where id = any(...)` after `retrieve()`) and attaching it
 * before calling `buildSourceBlock`/`buildUserTurn`. This keeps
 * `lib/chat/prompt.ts` a pure, DB-agnostic formatting layer.
 */
export interface PromptChunk extends RetrievedChunk {
  title: string
}

/**
 * A single validated inline citation — persisted verbatim into
 * `messages.citations` (Contract 2, specs/03-chat-grounding.md §3.4). Keys
 * stay snake_case to match the persisted JSON shape 1:1, no re-mapping
 * needed on read or write.
 */
export interface Citation {
  n: number
  /** `chunks.id` for a chunk citation, or `null` for a doc-level summary
   *  citation (see `RetrievedChunk.chunkId`). Persisted verbatim into
   *  `messages.citations` (unconstrained `jsonb`, no FK) and used by
   *  `hydrate.ts` to route reload lookup to `chunks` vs `sources`. */
  chunk_id: string | null
  source_id: string
}

export type ChatRole = "user" | "assistant"

/**
 * A single turn as fed into `streamText({ messages })` — plain role/content
 * pairs, not the AI SDK's richer `UIMessage` shape (that conversion is the
 * route handler's concern, out of scope for this pure service layer).
 */
export interface ChatMessage {
  role: ChatRole
  content: string
}

/**
 * Result of `parseCitations` (`lib/chat/citations.ts`) — Schicht 3
 * Post-Validation (specs/03-chat-grounding.md §4). `validCount` is the
 * number of distinct valid `n` values (i.e. `citations.length`);
 * `invalidCount` counts every removed/hallucinated marker occurrence
 * (not deduped — it is a logged quality signal, not persisted data).
 */
export interface ParsedCitations {
  cleanedContent: string
  citations: Citation[]
  invalidCount: number
  validCount: number
}

// ---------------------------------------------------------------------------
// UI-facing shapes (route ↔ `components/chat/*`) — specs/03-chat-grounding.md
// §7 "Highlight-Bridge". Data strategy (see task report for full rationale):
// the citation-popover needs the source title, the locator (page/paragraph),
// the cited passage, and char offsets to render + drive the Highlight-Bridge
// WITHOUT a per-click round trip. `messages.citations` (Contract 2) stays the
// stable, minimal `{n, chunk_id, source_id}` shape — CitationDetail is a
// client/route convenience shape, never persisted as-is. It is delivered two
// ways, both zero-extra-request for the popover:
//   - live turn: `app/api/chat/route.ts` already holds the retrieved chunks
//     + a source lookup (title/type) in memory, and attaches CitationDetail[]
//     to the `data-citations` UI message data part it writes after the
//     stream ends.
//   - reload: `lib/chat/hydrate.ts` reconstructs the same shape with ONE bulk
//     `chunks`/`sources` join query over every persisted citation across the
//     whole message history (not one query per message/citation).
export interface CitationDetail {
  n: number
  /** `null` for a doc-level summary citation (see `Citation.chunk_id`). */
  chunkId: string | null
  sourceId: string
  sourceTitle: string
  /** `sources.type` ("pdf" | "text" | "web" | "docx" | "xlsx" | "image" | …),
   *  carried through so the popover can show an image thumbnail (Design-
   *  Review 2026-07-20 §Teil 2) without a second round trip just to learn
   *  the source's type. */
  sourceType: string
  content: string
  charStart?: number
  charEnd?: number
  /** PDF page the chunk was extracted from (`buildChunkMetadata`,
   *  `lib/ingestion/service.ts`) — `undefined` for any source format that
   *  doesn't paginate (web/text/note), which is exactly the "no Seite" half
   *  of the locator line's clean degrade. */
  page?: number
  /** 1-indexed position of this chunk within its source's chunk sequence
   *  (`chunks.chunk_index` + 1) — the locator's "Absatz N". This is a
   *  document-wide ordinal, not a true per-page paragraph count: computing
   *  the latter would need every chunk of the page, not just the ones a
   *  single retrieval turn already holds in memory, which would break the
   *  zero-extra-request property above. Still a useful locator: it
   *  disambiguates two citations that land on the same `page`. */
  paragraph?: number
}

/** Payload of the `data-citations` UI message data part — see
 *  `CitationDetail`'s docstring for the "why a separate shape" rationale.
 *  `incomplete` is `finishReason !== "stop"` for the turn (§9 Fehler-Matrix,
 *  "Stream-Abbruch nach Teil-Tokens") — a UI-only flag, independent of the
 *  Ungrounded-Badge (DE-5), which stays a pure `(content, citations)`
 *  client-side render rule (see `stripIncompleteHint`, `lib/chat/prompt.ts`,
 *  for how `incomplete` survives a reload even though it has no DB column).
 *
 *  `isRefusal` (Review-Fix M2 — "Badge live vs reload inkonsistent") — whether
 *  the FINAL, server-normalized content is one of the two deterministic gate
 *  constants (`NO_COVERAGE_MESSAGE`/`NO_SOURCES_MESSAGE`, see `isGateMessage`
 *  in `lib/chat/messages.ts`). The route decides this AFTER `normalizeRefusal`
 *  has run, not the client: during live streaming, `message.parts` holds the
 *  RAW model text as it arrived token-by-token, which for a paraphrased
 *  refusal differs from the persisted/normalized constant — a client-side
 *  string compare against `content` would then disagree with what a page
 *  reload shows (reload hydrates from the already-normalized DB row). Both
 *  `app/api/chat/route.ts` (live) and `lib/chat/hydrate.ts` (reload) set this
 *  field from the SAME normalized string, so the Ungrounded-Badge render rule
 *  in `message-item.tsx` is identical either way. */
export interface ChatCitationsData {
  citations: CitationDetail[]
  incomplete: boolean
  isRefusal: boolean
}

/** `UIDataTypes` map for `useChat<ChatUIMessage>()` (AI SDK v7) — keys become
 *  the `data-${key}` part-type namespace. Only one data part kind exists so
 *  far. */
export type ChatDataParts = {
  citations: ChatCitationsData
}

/** The concrete `UIMessage` type this feature's client components and
 *  server-side hydration (`lib/chat/hydrate.ts`) share end to end, so
 *  `message.parts` entries of type `data-citations` are strongly typed
 *  without a manual cast at every call site. No custom metadata/tools. */
export type ChatUIMessage = import("ai").UIMessage<unknown, ChatDataParts>

/**
 * Reads the `char_start`/`char_end`/`page` integer fields the ingestion
 * pipeline writes into `chunks.metadata` (`lib/ingestion/service.ts`'s
 * `buildChunkMetadata`, Annahme A-2) — returns `{}` for anything else
 * (missing/malformed metadata, an alt-chunk predating offsets) so callers can
 * graceful-degrade (AC-G4: reader opens without scroll/highlight, locator
 * line omits "Seite") instead of throwing or showing "Seite undefined".
 */
export function readChunkOffsets(metadata: Json | null | undefined): {
  charStart?: number
  charEnd?: number
  page?: number
} {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {}
  }

  const record = metadata as Record<string, unknown>
  const charStart = record.char_start
  const charEnd = record.char_end
  const page = record.page

  return {
    charStart: typeof charStart === "number" ? charStart : undefined,
    charEnd: typeof charEnd === "number" ? charEnd : undefined,
    page: typeof page === "number" ? page : undefined,
  }
}
