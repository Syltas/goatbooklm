// Review-Fix L2: import ONLY from the client-safe `lib/chat/messages.ts`,
// never from `@/lib/chat/prompt` — that module also holds
// `GROUNDING_SYSTEM_PROMPT`/`buildSourceBlock`/`buildUserTurn`, server-only
// prompt-engineering text that must not ship in the client bundle.
import { INCOMPLETE_ANSWER_HINT, isGateMessage, stripIncompleteHint } from "@/lib/chat/messages"
import type { ChatUIMessage } from "@/lib/chat/types"

import type { OnCiteArgs } from "./citation-chip"
import { CitationRender } from "./citation-render"
import { UngroundedBadge } from "./ungrounded-badge"

interface MessageItemProps {
  message: ChatUIMessage
  isStreaming: boolean
  onCite: (args: OnCiteArgs) => void
}

export function MessageItem({ message, isStreaming, onCite }: MessageItemProps) {
  const rawText = message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")

  if (message.role === "user") {
    return (
      <div className="flex justify-end" data-test="chat-message" data-role="user">
        <div className="max-w-[80%] rounded-2xl bg-[var(--surface-2)] px-3.5 py-2 text-[15px] whitespace-pre-wrap text-foreground">
          {rawText}
        </div>
      </div>
    )
  }

  const dataPart = message.parts.find(
    (part): part is Extract<typeof part, { type: "data-citations" }> =>
      part.type === "data-citations"
  )

  const { content, hadHint } = stripIncompleteHint(rawText)
  const citations = dataPart?.data.citations ?? []
  const incomplete = hadHint || (dataPart?.data.incomplete ?? false)

  // Review-Fix M2 — primary signal is the route/hydrate-decided `isRefusal`
  // flag (computed server-side against the NORMALIZED content in both
  // cases, see `ChatCitationsData`'s docstring). `isGateMessage(content)` is
  // only a fallback for a `dataPart` that — hypothetically — lacks the flag;
  // it must NOT be the primary check, since during live streaming `content`
  // is the RAW, possibly-paraphrased model text, not the normalized one.
  const isRefusal = dataPart?.data.isRefusal ?? isGateMessage(content)

  // The Ungrounded-Badge only makes sense once the turn's final citations
  // are known (`dataPart` present) — a currently-streaming message hasn't
  // reached `data-citations` yet and would otherwise flash the badge.
  const ungrounded =
    dataPart != null &&
    !isRefusal &&
    citations.length === 0 &&
    content.trim().length > 0

  return (
    <div className="flex flex-col items-start gap-1.5" data-test="chat-message" data-role="assistant">
      <div className="max-w-[85%] text-[15px] leading-[1.6] whitespace-pre-wrap text-foreground">
        <CitationRender content={content} citations={citations} onCite={onCite} />
        {isStreaming && (
          <span
            className="ml-0.5 inline-block h-4 w-1.5 align-middle bg-muted-foreground motion-safe:animate-pulse"
            aria-hidden="true"
          />
        )}
      </div>
      {incomplete && (
        <p className="text-xs text-muted-foreground" data-test="chat-message-incomplete">
          {INCOMPLETE_ANSWER_HINT}
        </p>
      )}
      {ungrounded && <UngroundedBadge />}
    </div>
  )
}
