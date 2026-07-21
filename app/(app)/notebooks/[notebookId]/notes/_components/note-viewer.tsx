"use client"

import { FileOutput, Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import type { OnCiteArgs } from "@/components/chat/citation-chip"
import { CitationRender } from "@/components/chat/citation-render"
import { Button } from "@/components/ui/button"
import type { CitationDetail } from "@/lib/chat/types"
import type { Note } from "@/lib/notes/service"

import { convertNoteToSourceAction } from "../actions"

interface NoteViewerProps {
  note: Note
  /** Citation-chip jump — flips the shared source reader (and, on mobile,
   *  swaps the studio sheet for the sources sheet). Wired in `StudioPanel`
   *  exactly like the chat's own `onCite` (`notebook-detail-shell.tsx`). */
  onCite: (args: OnCiteArgs) => void
  onUpdated?: (note: Note) => void
}

/**
 * Coerces the note's stored `citations` jsonb back into `CitationDetail[]`.
 * The array was shape-validated on write (`SaveTextAsNoteSchema`), so this is
 * a defensive narrow, not a re-validate — it only guards against a hand-edited
 * / legacy row so a bad shape degrades to "no chip" (the marker stays raw
 * text, exactly what `CitationRender` does for an unmatched `[n]`) instead of
 * throwing inside render.
 */
function toCitationDetails(value: unknown): CitationDetail[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is CitationDetail =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as CitationDetail).n === "number" &&
      typeof (item as CitationDetail).sourceId === "string" &&
      typeof (item as CitationDetail).sourceTitle === "string" &&
      typeof (item as CitationDetail).content === "string"
  )
}

/**
 * Read-only view for a chat-origin note (`origin === 'chat'`). Renders the
 * captured chat markdown with the SAME `CitationRender` + `CitationChip` stack
 * the live chat uses — so headings/lists/tables render as real markdown and
 * every `[n]` marker is a hover/click-interactive citation chip, identical to
 * the chat. The body is not editable (it's a captured artifact); the note is
 * still renamable from the list row and deletable, and "Zu Quelle machen"
 * stays available (it reads `notes.content`, which the save action still
 * populates as a plaintext projection of this markdown).
 */
export function NoteViewer({ note, onCite, onUpdated }: NoteViewerProps) {
  const [converting, setConverting] = useState(false)

  const markdown = note.markdown ?? ""
  const citations = toCitationDetails(note.citations)

  async function handleConvertToSource() {
    if (converting) return
    setConverting(true)
    try {
      const result = await convertNoteToSourceAction({ id: note.id })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      onUpdated?.(note)
      toast.success(`„${result.data.title}“ wurde als Quelle hinzugefügt.`)
    } finally {
      setConverting(false)
    }
  }

  return (
    <div className="flex h-full flex-col" data-test="note-viewer">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <h2
          className="flex-1 truncate px-1 text-base font-bold text-foreground"
          data-test="note-viewer-title"
        >
          {note.title}
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div
          className="mx-auto max-w-2xl rounded-xl bg-card px-6 py-5 text-[15px] leading-[1.75] text-foreground"
          data-test="note-viewer-content"
        >
          <CitationRender content={markdown} citations={citations} onCite={onCite} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleConvertToSource}
          disabled={converting}
          data-test="note-convert-to-source-button"
        >
          {converting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileOutput className="size-3.5" />
          )}
          Zu Quelle machen
        </Button>
      </div>
    </div>
  )
}
