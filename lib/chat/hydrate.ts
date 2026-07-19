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
  for (const row of rows) {
    if (row.role !== "assistant") continue
    for (const citation of parseCitationsColumn(row.citations)) {
      chunkIds.add(citation.chunk_id)
    }
  }

  const detailByChunkId = new Map<
    string,
    { content: string; metadata: Json; sourceTitle: string }
  >()

  if (chunkIds.size > 0) {
    const { data, error } = await db
      .from("chunks")
      .select("id, content, metadata, sources(title)")
      .in("id", [...chunkIds])

    if (error) throw error

    for (const chunk of data ?? []) {
      detailByChunkId.set(chunk.id, {
        content: chunk.content,
        metadata: chunk.metadata,
        sourceTitle: chunk.sources?.title ?? "Unbenannte Quelle",
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
      const detail = detailByChunkId.get(citation.chunk_id)
      const offsets = readChunkOffsets(detail?.metadata)
      return {
        n: citation.n,
        chunkId: citation.chunk_id,
        sourceId: citation.source_id,
        sourceTitle: detail?.sourceTitle ?? "Unbenannte Quelle",
        content: detail?.content ?? "",
        charStart: offsets.charStart,
        charEnd: offsets.charEnd,
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
