import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Json } from "@/lib/database.types"

import { isGateMessage, stripIncompleteHint } from "./messages"
import type {
  ChatCitationsData,
  ChatUIMessage,
  Citation,
  CitationDetail,
} from "./types"
import { readChunkOffsets } from "./types"

type MessageRow = Database["public"]["Tables"]["messages"]["Row"]

/**
 * Reconstructs `useChat`'s `initialMessages` from persisted `messages` rows
 * (specs/03-chat-grounding.md §6 "Hydration") — the server-component
 * counterpart to `app/api/chat/route.ts`'s live turn. Chosen data strategy
 * (see `CitationDetail`'s docstring, `lib/chat/types.ts`, and the task
 * report): rather than a fetch per citation-popover open, this does ONE bulk
 * `chunks`/`sources` join query across every citation in the WHOLE loaded
 * history, so a reloaded notebook's popovers are just as zero-round-trip as
 * a live turn's.
 *
 * `db` is injected (request-scoped, RLS-backed) — this stays callable from a
 * Server Component (`page.tsx`) without importing a client singleton, same
 * discipline as `lib/chat/service.ts`.
 */
export async function buildInitialMessages(
  db: SupabaseClient<Database>,
  rows: MessageRow[]
): Promise<ChatUIMessage[]> {
  const chunkIds = new Set<string>()
  // chat-retrieval-rerank Phase 1: a doc-level summary citation has
  // `chunk_id === null` (no `chunks` row) — it is rehydrated from `sources` by
  // `source_id` instead, and must NEVER enter the `.in("id", …)` against the
  // `uuid` `chunks.id` below (a non-uuid there throws 22P02 and kills the whole
  // notebook's hydration).
  const summarySourceIds = new Set<string>()
  for (const row of rows) {
    if (row.role !== "assistant") continue
    for (const citation of parseCitationsColumn(row.citations)) {
      if (citation.chunk_id === null) {
        summarySourceIds.add(citation.source_id)
      } else {
        chunkIds.add(citation.chunk_id)
      }
    }
  }

  const detailByChunkId = new Map<
    string,
    {
      content: string
      metadata: Json
      chunkIndex: number
      sourceTitle: string
      sourceType: string
    }
  >()

  if (chunkIds.size > 0) {
    // `chunk_index`/`sources(type)` ride along with the same bulk query —
    // needed for the locator line's "Absatz N" and the popover's image
    // thumbnail (Design-Review 2026-07-20 §Teil 1/2), without turning this
    // back into a per-citation lookup.
    const { data, error } = await db
      .from("chunks")
      .select("id, content, metadata, chunk_index, sources(title, type)")
      .in("id", [...chunkIds])

    if (error) throw error

    for (const chunk of data ?? []) {
      detailByChunkId.set(chunk.id, {
        content: chunk.content,
        metadata: chunk.metadata,
        chunkIndex: chunk.chunk_index,
        sourceTitle: chunk.sources?.title ?? "Unbenannte Quelle",
        sourceType: chunk.sources?.type ?? "text",
      })
    }
  }

  // Summary-citation rehydration (chunk_id === null): one bulk `sources`
  // lookup by source_id for title/type + the summary text as the popover
  // passage. No offsets — a summary is a whole-doc overview, so the locator
  // line + highlight degrade cleanly (same path as an offset-less chunk).
  const summaryBySourceId = new Map<
    string,
    { sourceTitle: string; sourceType: string; content: string }
  >()
  if (summarySourceIds.size > 0) {
    const { data, error } = await db
      .from("sources")
      .select("id, title, type, summary")
      .in("id", [...summarySourceIds])

    if (error) throw error

    for (const src of data ?? []) {
      summaryBySourceId.set(src.id, {
        sourceTitle: src.title ?? "Unbenannte Quelle",
        sourceType: src.type ?? "text",
        content: src.summary ?? "",
      })
    }
  }

  return rows.map((row): ChatUIMessage => {
    if (row.role !== "assistant") {
      return {
        id: row.id,
        role: "user",
        parts: [{ type: "text", text: row.content, state: "done" }],
      }
    }

    const { content, hadHint } = stripIncompleteHint(row.content)
    const citations = parseCitationsColumn(row.citations)

    const citationDetails: CitationDetail[] = citations.map((citation) => {
      if (citation.chunk_id === null) {
        const summary = summaryBySourceId.get(citation.source_id)
        return {
          n: citation.n,
          chunkId: null,
          sourceId: citation.source_id,
          sourceTitle: summary?.sourceTitle ?? "Unbenannte Quelle",
          sourceType: summary?.sourceType ?? "text",
          content: summary?.content ?? "",
          charStart: undefined,
          charEnd: undefined,
          page: undefined,
          paragraph: undefined,
        }
      }
      const detail = detailByChunkId.get(citation.chunk_id)
      const offsets = readChunkOffsets(detail?.metadata)
      return {
        n: citation.n,
        chunkId: citation.chunk_id,
        sourceId: citation.source_id,
        sourceTitle: detail?.sourceTitle ?? "Unbenannte Quelle",
        sourceType: detail?.sourceType ?? "text",
        content: detail?.content ?? "",
        charStart: offsets.charStart,
        charEnd: offsets.charEnd,
        page: offsets.page,
        // See `buildCitationDetails` (`app/api/chat/route.ts`) for why this
        // is a document-wide ordinal, not a true per-page paragraph count.
        paragraph: typeof detail?.chunkIndex === "number" ? detail.chunkIndex + 1 : undefined,
      }
    })

    const citationsData: ChatCitationsData = {
      citations: citationDetails,
      incomplete: hadHint,
      // Review-Fix M2 — hydration reads the already-normalized `content`
      // straight from the DB row, so this is the same "is one of the gate
      // constants" check the route makes live (see `ChatCitationsData`'s
      // docstring, `lib/chat/types.ts`).
      isRefusal: isGateMessage(content),
    }

    return {
      id: row.id,
      role: "assistant",
      parts: [
        { type: "text", text: content, state: "done" },
        { type: "data-citations", data: citationsData },
      ],
    }
  })
}

function parseCitationsColumn(value: Json): Citation[] {
  if (!Array.isArray(value)) return []
  return value as unknown as Citation[]
}
