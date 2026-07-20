"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Check, Copy, StickyNote } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import type { ChatUIMessage } from "@/lib/chat/types"
import { saveTextAsNoteAction } from "@/app/(app)/notebooks/[notebookId]/notes/actions"

import { ChatInput } from "./chat-input"
import type { OnCiteArgs } from "./citation-chip"
import { MessageList } from "./message-list"

interface ChatPanelProps {
  notebookId: string
  initialMessages: ChatUIMessage[]
  readyCount: number
  /**
   * Part A — the notebook's cached corpus summary, already resolved to
   * "valid or null" by the caller (`NotebookDetailShell`): `null` covers
   * both "never generated yet" and "generation failed/stale" (see
   * `lib/notebooks/summary-service.ts`'s docstring for why those collapse to
   * one fallback rather than three distinct UI states) — this component
   * only ever has to branch on presence, not on WHY it's absent.
   */
  notebookSummary: string | null
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
}

/** v1 static, generic suggestions (§6 "Empty-Chat-State", AC-50) — not
 *  derived from the notebook's actual sources, which would need an extra
 *  LLM call (explicitly out of scope). Still the fallback for a notebook
 *  that HAS ready sources but no valid summary yet (never generated, or the
 *  generation failed) — Part A only replaces this branch, never removes it,
 *  per the DoD's "Fehlerfall bleibt der leere Chat benutzbar". */
const SUGGESTED_QUESTIONS = [
  "Worum geht es in diesen Quellen?",
  "Fasse die wichtigsten Punkte zusammen.",
  "Welche zentralen Begriffe tauchen auf?",
]

/** Part A — title for a summary saved as a note, distinct from a saved chat
 *  answer's title (`message-item.tsx`'s `CHAT_ANSWER_NOTE_TITLE`) so the two
 *  are distinguishable in the Studio panel's note list. */
const NOTEBOOK_SUMMARY_NOTE_TITLE = "Notizbuch-Zusammenfassung"

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
  notebookSummary,
  onCite,
  historyClearedAt,
  onMessageCountChange,
}: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [summaryCopied, setSummaryCopied] = useState(false)

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

  function handleSend(text: string) {
    const trimmed = text.trim()
    if (!trimmed || disabled || isBusy) return
    setInput("")
    void sendMessage({ text: trimmed })
  }

  // Part B — a follow-up chip click sends it immediately, unlike the static
  // suggestions above (which only fill the input for the user to review/
  // edit first): the chip's whole text already IS a complete, deliberately
  // phrased question the model just generated FOR this notebook, so there's
  // nothing to edit first.
  function handleAskFollowUp(question: string) {
    if (disabled || isBusy) return
    void sendMessage({ text: question })
  }

  function handleRetry() {
    clearError()
    void regenerate()
  }

  async function handleCopySummary() {
    if (!notebookSummary) return
    try {
      await navigator.clipboard.writeText(notebookSummary)
      setSummaryCopied(true)
      toast.success("In die Zwischenablage kopiert.")
      window.setTimeout(() => setSummaryCopied(false), 2000)
    } catch {
      toast.error("Kopieren fehlgeschlagen.")
    }
  }

  async function handleSaveSummaryAsNote() {
    if (!notebookSummary) return
    const result = await saveTextAsNoteAction({
      notebookId,
      title: NOTEBOOK_SUMMARY_NOTE_TITLE,
      text: notebookSummary,
    })
    if ("error" in result) {
      toast.error(result.error)
    } else {
      toast.success("Notiz gespeichert.")
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            {disabled ? (
              <p className="text-sm text-muted-foreground">
                Fügen Sie zuerst eine Quelle hinzu, um zu chatten.
              </p>
            ) : notebookSummary ? (
              // Part A — replaces BOTH the hint text and the static
              // suggestions below with the notebook's actual corpus summary
              // ("dort, wo heute … stehen" — this branch owns that whole
              // slot, not just the hint line).
              <div
                className="flex max-w-[560px] flex-col items-center gap-4"
                data-test="chat-notebook-summary"
              >
                <p
                  className="text-left text-sm leading-relaxed text-foreground"
                  data-test="chat-notebook-summary-text"
                >
                  {notebookSummary}
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    data-test="chat-summary-save-note"
                    className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--action)]"
                    onClick={handleSaveSummaryAsNote}
                  >
                    <StickyNote className="size-3.5" aria-hidden="true" />
                    Als Notiz speichern
                  </button>
                  <button
                    type="button"
                    data-test="chat-summary-copy"
                    className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--action)]"
                    onClick={handleCopySummary}
                  >
                    {summaryCopied ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="size-3.5" aria-hidden="true" />
                    )}
                    Kopieren
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Stellen Sie eine Frage zu Ihren Quellen.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTED_QUESTIONS.map((question) => (
                    <button
                      key={question}
                      type="button"
                      data-test="chat-suggested-question-chip"
                      className="rounded-full border border-border bg-card px-3.5 py-2 text-[13.5px] font-semibold text-foreground outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-[var(--action)]"
                      onClick={() => setInput(question)}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <MessageList
            messages={messages}
            status={status}
            notebookId={notebookId}
            onCite={onCite}
            onAskFollowUp={handleAskFollowUp}
          />
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

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        disabled={disabled}
        busy={isBusy}
        readyCount={readyCount}
      />
    </div>
  )
}
