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
}

/**
 * §6 "ChatInput" — Textarea + Senden-Button. `disabled` (0 ready sources,
 * AC-B1) shows `chat-empty-hint` and locks the whole composer; `busy`
 * (submitted/streaming, AC-F3) locks it mid-turn without the empty-notebook
 * copy. Enter sends, Shift+Enter inserts a newline (§6).
 */
export function ChatInput({ value, onChange, onSend, disabled, busy }: ChatInputProps) {
  const canSend = !disabled && !busy && value.trim().length > 0

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (canSend) onSend(value)
    }
  }

  return (
    <div className="shrink-0 border-t border-border p-3">
      {disabled && (
        <p className="mb-2 text-xs text-muted-foreground" data-test="chat-empty-hint">
          Fügen Sie zuerst eine Quelle hinzu, um zu chatten.
        </p>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || busy}
          placeholder="Stellen Sie eine Frage zu Ihren Quellen…"
          className="max-h-40 min-h-11 resize-none"
          aria-label="Chat-Nachricht"
          data-test="chat-input"
        />
        <Button
          type="button"
          size="icon"
          className="min-h-11 min-w-11 shrink-0 rounded-full"
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
