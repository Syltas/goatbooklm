"use client"

import { ArrowUp } from "lucide-react"
import type { KeyboardEvent } from "react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void
  disabled: boolean
  busy: boolean
  /** Display-only — the same live-polled ready-source count `ChatPanel`
   *  already derives, shown next to the composer per the v2 design
   *  ("Quellen-Zähler"). Purely presentational, no behavior tied to it. */
  readyCount: number
}

/**
 * §6 "ChatInput" — Textarea + Senden-Button. `disabled` (0 ready sources,
 * AC-B1) shows `chat-empty-hint` and locks the whole composer; `busy`
 * (submitted/streaming, AC-F3) locks it mid-turn without the empty-notebook
 * copy. Enter sends, Shift+Enter inserts a newline (§6).
 */
export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  busy,
  readyCount,
}: ChatInputProps) {
  const canSend = !disabled && !busy && value.trim().length > 0

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (canSend) onSend(value)
    }
  }

  return (
    <div className="shrink-0 px-4 pt-3 pb-4">
      {disabled && (
        <p
          className="mx-auto mb-2 max-w-[720px] text-xs text-muted-foreground"
          data-test="chat-empty-hint"
        >
          Fügen Sie zuerst eine Quelle hinzu, um zu chatten.
        </p>
      )}
      <div className="mx-auto flex max-w-[720px] items-end gap-2 rounded-[16px] border border-border bg-card py-2 pr-2 pl-4 focus-within:border-[var(--action)]">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || busy}
          placeholder="Stellen Sie eine Frage zu Ihren Quellen…"
          className="max-h-40 min-h-7 flex-1 resize-none border-none bg-transparent px-0 py-1.5 text-[15px] leading-[1.6] text-foreground shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent"
          aria-label="Chat-Nachricht"
          data-test="chat-input"
        />
        <span
          className="shrink-0 self-center text-[12.5px] whitespace-nowrap text-[var(--text-faint)]"
          data-test="chat-source-count"
        >
          {readyCount} {readyCount === 1 ? "Quelle" : "Quellen"}
        </span>
        <Button
          type="button"
          size="icon"
          className="size-10 shrink-0 rounded-full"
          disabled={!canSend}
          onClick={() => onSend(value)}
          aria-label="Senden"
          data-test="chat-send"
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  )
}
