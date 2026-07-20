"use client"

import { useEffect, useRef } from "react"

import type { ChatUIMessage } from "@/lib/chat/types"

import type { OnCiteArgs } from "./citation-chip"
import { MessageItem } from "./message-item"

interface MessageListProps {
  messages: ChatUIMessage[]
  status: "submitted" | "streaming" | "ready" | "error"
  notebookId: string
  onCite: (args: OnCiteArgs) => void
  onAskFollowUp: (question: string) => void
}

export function MessageList({
  messages,
  status,
  notebookId,
  onCite,
  onAskFollowUp,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // Part B — follow-up chips only ever render under the LAST assistant
  // message, regardless of streaming state; found once here rather than
  // re-derived per item so every `MessageItem` agrees on which one it is.
  const lastAssistantIndex = messages.reduce(
    (lastIndex, message, index) => (message.role === "assistant" ? index : lastIndex),
    -1
  )

  useEffect(() => {
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    endRef.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "end",
    })
  }, [messages, status])

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-6 py-5">
      {messages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          notebookId={notebookId}
          // Befund 1 (adversarial review): `status` flips "streaming" ->
          // "error" the instant the stream fails, but the text already
          // buffered client-side is exactly as likely to have been cut off
          // mid-`FOLLOW_UP_TRAILER_MARKER` as a server-side abort is (see
          // `app/api/chat/route.ts`'s `finishReason !== "stop"` handling of
          // the same failure mode). Treating "error" as still-streaming here
          // keeps `splitFollowUpTrailer` holding back a partial marker
          // fragment instead of flashing/copying/saving it as real content.
          isStreaming={
            (status === "streaming" || status === "error") &&
            index === messages.length - 1 &&
            message.role === "assistant"
          }
          isLastAssistantMessage={index === lastAssistantIndex}
          onCite={onCite}
          onAskFollowUp={onAskFollowUp}
        />
      ))}
      {status === "submitted" && (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-test="chat-streaming-indicator"
        >
          <span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse" />
          Antwort wird generiert…
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
