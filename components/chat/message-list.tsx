"use client"

import { useEffect, useRef } from "react"

import type { ChatUIMessage } from "@/lib/chat/types"

import type { OnCiteArgs } from "./citation-chip"
import { MessageItem } from "./message-item"

interface MessageListProps {
  messages: ChatUIMessage[]
  status: "submitted" | "streaming" | "ready" | "error"
  onCite: (args: OnCiteArgs) => void
}

export function MessageList({ messages, status, onCite }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

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
    <div className="flex flex-col gap-4 px-4 py-4">
      {messages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          isStreaming={
            status === "streaming" &&
            index === messages.length - 1 &&
            message.role === "assistant"
          }
          onCite={onCite}
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
