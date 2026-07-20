"use client"

import { Check, Copy, StickyNote } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

// Review-Fix L2: import ONLY from the client-safe `lib/chat/messages.ts`,
// never from `@/lib/chat/prompt` — that module also holds
// `GROUNDING_SYSTEM_PROMPT`/`buildSourceBlock`/`buildUserTurn`, server-only
// prompt-engineering text that must not ship in the client bundle.
import {
  INCOMPLETE_ANSWER_HINT,
  isGateMessage,
  parseFollowUpQuestions,
  splitFollowUpTrailer,
  stripIncompleteHint,
} from "@/lib/chat/messages"
import type { ChatUIMessage } from "@/lib/chat/types"
import { saveTextAsNoteAction } from "@/app/(app)/notebooks/[notebookId]/notes/actions"

import type { OnCiteArgs } from "./citation-chip"
import { CitationRender } from "./citation-render"
import { UngroundedBadge } from "./ungrounded-badge"

interface MessageItemProps {
  message: ChatUIMessage
  notebookId: string
  isStreaming: boolean
  /** Part B: follow-up chips only ever render under the LAST assistant
   *  message in the transcript — "Ältere Antworten zeigen keine." */
  isLastAssistantMessage: boolean
  onCite: (args: OnCiteArgs) => void
  /** A follow-up chip click sends it as a new question immediately (unlike
   *  the empty-chat's static suggestions, which only fill the input) — see
   *  `ChatPanel`'s `handleAskFollowUp`. */
  onAskFollowUp: (question: string) => void
}

/** "Als Notiz speichern" title for a saved assistant answer — distinct from
 *  the empty-chat summary's own title (`ChatPanel`'s `NOTEBOOK_SUMMARY_NOTE_TITLE`)
 *  so the two are distinguishable in the Studio panel's note list. */
const CHAT_ANSWER_NOTE_TITLE = "Notiz aus Chat"

export function MessageItem({
  message,
  notebookId,
  isStreaming,
  isLastAssistantMessage,
  onCite,
  onAskFollowUp,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false)

  const rawText = message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")

  if (message.role === "user") {
    return (
      <div className="flex justify-end" data-test="chat-message" data-role="user">
        <div className="max-w-[80%] rounded-tl-[18px] rounded-tr-[18px] rounded-br-[4px] rounded-bl-[18px] bg-[var(--surface-2)] px-4 py-2.5 text-[15px] leading-[1.6] whitespace-pre-wrap text-foreground">
          {rawText}
        </div>
      </div>
    )
  }

  const dataPart = message.parts.find(
    (part): part is Extract<typeof part, { type: "data-citations" }> =>
      part.type === "data-citations"
  )

  const { content: afterHintStrip, hadHint } = stripIncompleteHint(rawText)
  // Part B "Folgefragen als Trailer" — split off the model's own trailer
  // block BEFORE anything else touches this text. `isStreaming` is what
  // makes this safe to run on every render, including mid-stream: while
  // still arriving, an in-progress marker is held back rather than flashed
  // (see `splitFollowUpTrailer`'s docstring for the full "why").
  const { content, trailer } = splitFollowUpTrailer(afterHintStrip, isStreaming)
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

  // Part B — "Am Ende jeder ABGESCHLOSSENEN Assistant-Antwort" / "Während
  // des Streamens sind weder Aktionen noch Folgefragen sichtbar". The
  // actions row is gated on `!isStreaming` AND `!isRefusal`: a gate refusal
  // (`NO_COVERAGE_MESSAGE`/`NO_SOURCES_MESSAGE`) is a deterministic system
  // notice, not a real answer — nothing about it is worth saving as a note
  // or copying, the same reasoning `GROUNDING_SYSTEM_PROMPT` rule 9 already
  // applies to the follow-up trailer ("do NOT append this block" after a
  // refusal). Follow-up chips are additionally gated on
  // `isLastAssistantMessage`, since only the newest answer gets them. A
  // trailer that fails to parse into anything falls back to an empty list
  // (never throws — see `parseFollowUpQuestions`'s docstring), which here
  // just means no chips render, not a broken message.
  const showActions = !isStreaming && !isRefusal && content.trim().length > 0
  const followUpQuestions =
    !isStreaming && !isRefusal && isLastAssistantMessage && trailer
      ? parseFollowUpQuestions(trailer)
      : []

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      toast.success("In die Zwischenablage kopiert.")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Kopieren fehlgeschlagen.")
    }
  }

  async function handleSaveNote() {
    const result = await saveTextAsNoteAction({
      notebookId,
      title: CHAT_ANSWER_NOTE_TITLE,
      text: content,
    })
    if ("error" in result) {
      toast.error(result.error)
    } else {
      toast.success("Notiz gespeichert.")
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5" data-test="chat-message" data-role="assistant">
      {/* No `whitespace-pre-wrap` here — `CitationRender` emits real block
          elements now, and preserving the source newlines on top of that
          double-spaces every paragraph. */}
      {/* v2: `MessageList`'s outer wrapper now caps the whole transcript at
          720px (design's "Inhalt max-w 720 zentriert") — that upper bound
          is what used to make an unqualified `%` cap here risky (see the
          removed comment in git history: on a wide, dragged-open Chat panel
          a percentage alone stretched to unreadable line lengths). With the
          720px ceiling already in place one level up, 90% of an
          already-capped container stays readable at every panel width, so
          this can match the design's literal percentage instead of an
          ad-hoc `ch` unit. */}
      <div className="max-w-[90%] text-[15px] leading-[1.75] text-foreground">
        {/* `isStreaming` gates hover-to-open on the chips inside — see
            `CitationChip`'s docstring for why a still-streaming message's
            chips (which can still reflow) must not open a hover card. */}
        <CitationRender
          content={content}
          citations={citations}
          onCite={onCite}
          isStreaming={isStreaming}
        />
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
      {showActions && (
        <div className="flex items-center gap-3" data-test="chat-message-actions">
          <button
            type="button"
            data-test="chat-message-save-note"
            className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--action)]"
            onClick={handleSaveNote}
          >
            <StickyNote className="size-3.5" aria-hidden="true" />
            Als Notiz speichern
          </button>
          <button
            type="button"
            data-test="chat-message-copy"
            className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--action)]"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            Kopieren
          </button>
        </div>
      )}
      {followUpQuestions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2" data-test="chat-followup-questions">
          {followUpQuestions.map((question) => (
            <button
              key={question}
              type="button"
              data-test="chat-followup-chip"
              className="rounded-full border border-border bg-card px-3.5 py-2 text-[13.5px] font-semibold text-foreground outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-[var(--action)]"
              onClick={() => onAskFollowUp(question)}
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
