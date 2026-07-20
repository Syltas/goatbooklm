"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useEffect, useRef, useState } from "react"

import type { ChatUIMessage } from "@/lib/chat/types"

import { ChatInput } from "./chat-input"
import type { OnCiteArgs } from "./citation-chip"
import { MessageList } from "./message-list"

interface ChatPanelProps {
  notebookId: string
  initialMessages: ChatUIMessage[]
  readyCount: number
  onCite: (args: OnCiteArgs) => void
  /**
   * Bumped by the shell after `deleteChatHistoryAction` succeeded. The
   * transcript lives in `useChat`'s client state, not in RSC state, so a
   * `revalidatePath` alone would leave the old bubbles on screen until a full
   * reload — this is the signal to drop them.
   */
  historyClearedAt?: number
  /** Lets the shell disable the "Chatverlauf löschen" item while the
   *  transcript is empty, using the live client count rather than the
   *  server-rendered `initialMessages` snapshot. */
  onMessageCountChange?: (count: number) => void
  /**
   * Explain-Bridge from the Studio panel (docs/specs/studio-quick-wins.md):
   * a prepared prompt to send as a user turn. `nonce` makes repeated
   * identical prompts distinguishable — same change-only pattern as
   * `historyClearedAt`.
   */
  injectedPrompt?: { text: string; nonce: number } | null
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
export function ChatPanel({
  notebookId,
  initialMessages,
  readyCount,
  onCite,
  historyClearedAt,
  onMessageCountChange,
  injectedPrompt,
}: ChatPanelProps) {
  const [input, setInput] = useState("")

  const { messages, setMessages, sendMessage, status, error, regenerate, clearError } =
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

  // Only react to *changes* of the signal, never to its initial value — a
  // fresh mount already starts from the server-rendered transcript, and
  // clearing it here would wipe the history on every remount.
  const lastClearedAt = useRef(historyClearedAt)
  useEffect(() => {
    if (historyClearedAt === lastClearedAt.current) return
    lastClearedAt.current = historyClearedAt
    setMessages([])
    clearError()
  }, [historyClearedAt, setMessages, clearError])

  useEffect(() => {
    onMessageCountChange?.(messages.length)
  }, [messages.length, onMessageCountChange])

  // React only to nonce *changes* (mount must not re-send a stale prompt).
  // While a turn is already streaming, fall back to pre-filling the input
  // instead of interleaving a second in-flight request.
  const lastInjectedNonce = useRef(injectedPrompt?.nonce)
  useEffect(() => {
    if (!injectedPrompt || injectedPrompt.nonce === lastInjectedNonce.current) return
    lastInjectedNonce.current = injectedPrompt.nonce
    if (disabled) return
    if (isBusy) {
      setInput(injectedPrompt.text)
      return
    }
    void sendMessage({ text: injectedPrompt.text })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedPrompt])

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
