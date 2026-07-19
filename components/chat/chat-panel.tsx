"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useState } from "react"

import type { ChatUIMessage } from "@/lib/chat/types"

import { ChatInput } from "./chat-input"
import type { OnCiteArgs } from "./citation-chip"
import { MessageList } from "./message-list"

interface ChatPanelProps {
  notebookId: string
  initialMessages: ChatUIMessage[]
  readyCount: number
  onCite: (args: OnCiteArgs) => void
}

/** v1 static, generic suggestions (§6 "Empty-Chat-State", AC-50) — not
 *  derived from the notebook's actual sources, which would need an extra
 *  LLM call (explicitly out of scope). */
const SUGGESTED_QUESTIONS = [
  "Worum geht es in diesen Quellen?",
  "Fasse die wichtigsten Punkte zusammen.",
  "Welche zentralen Begriffe tauchen auf?",
]

/**
 * `components/chat/chat-panel.tsx` — the middle Notebook-Detail panel (§6).
 * `useChat`'s default transport sends the whole client-held `messages` array
 * as the request body; the HTTP contract (§3.4, OV4) is deliberately just
 * `{ notebookId, question }` instead, so `prepareSendMessagesRequest`
 * overrides the body entirely — the client-held `messages` list stays
 * client-rendering-only (optimistic user bubble, streaming display), never
 * reaches the server as a forgeable array (AC-44).
 */
export function ChatPanel({ notebookId, initialMessages, readyCount, onCite }: ChatPanelProps) {
  const [input, setInput] = useState("")

  const { messages, sendMessage, status, error, regenerate, clearError } =
    useChat<ChatUIMessage>({
      id: notebookId,
      messages: initialMessages,
      transport: new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages: requestMessages }) => {
          const lastUserMessage = [...requestMessages].reverse().find((m) => m.role === "user")
          const question = lastUserMessage
            ? lastUserMessage.parts
                .filter((part): part is Extract<typeof part, { type: "text" }> =>
                  part.type === "text"
                )
                .map((part) => part.text)
                .join("")
            : ""

          return { body: { notebookId, question } }
        },
      }),
    })

  const disabled = readyCount === 0
  const isBusy = status === "submitted" || status === "streaming"

  function handleSend(text: string) {
    const trimmed = text.trim()
    if (!trimmed || disabled || isBusy) return
    setInput("")
    void sendMessage({ text: trimmed })
  }

  function handleRetry() {
    clearError()
    void regenerate()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              {disabled
                ? "Fügen Sie zuerst eine Quelle hinzu, um zu chatten."
                : "Stellen Sie eine Frage zu Ihren Quellen."}
            </p>
            {!disabled && (
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    data-test="chat-suggested-question-chip"
                    className="rounded-full bg-[var(--surface-2)] px-3 py-1.5 text-sm text-foreground outline-none hover:bg-border/60 focus-visible:ring-2 focus-visible:ring-[var(--action)]"
                    onClick={() => setInput(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <MessageList messages={messages} status={status} onCite={onCite} />
        )}
      </div>

      {error && (
        <div className="shrink-0 border-t border-border px-4 py-2.5" data-test="chat-error">
          <p className="text-sm text-[var(--danger)]">{error.message || "Etwas ist schiefgelaufen."}</p>
          <button
            type="button"
            data-test="chat-error-retry"
            className="mt-1 min-h-11 rounded-sm text-sm font-medium text-[var(--action)] outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-[var(--action)]"
            onClick={handleRetry}
          >
            Erneut versuchen
          </button>
        </div>
      )}

      <ChatInput value={input} onChange={setInput} onSend={handleSend} disabled={disabled} busy={isBusy} />
    </div>
  )
}
