"use client"

import { Trash2 } from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Note } from "@/lib/notes/service"

import { updateNoteAction } from "../actions"

const noteDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "long",
  year: "numeric",
})

function formatNoteDate(iso: string): string {
  return noteDateFormatter.format(new Date(iso))
}

interface NoteListItemProps {
  note: Note
  onOpen: (note: Note) => void
  onUpdated: (note: Note) => void
  onDeleteRequest: (note: Note) => void
}

/**
 * Row has two independent interactions: an inline title rename (saves on
 * blur, same as before — a still-typing title never fires a request per
 * character, and an empty or unchanged value is never sent at all) and
 * opening the note into the full TipTap editor. This can't reuse
 * `notebook-card.tsx`'s absolute-overlay-Link pattern (an inset-0 overlay
 * behind the real controls, elevated via `relative z-20`): unlike that
 * card, the title here is a live, always-rendered `Input` spanning most of
 * the row's width and height, so a z-20 `Input` would block the overlay
 * across nearly the whole row (confirmed — it made "open" unclickable
 * outside a thin sliver). Instead the row itself opens the note on click,
 * and the title `Input`/delete `Button` each `stopPropagation` in their
 * own `onClick` so interacting with them never also opens the note.
 */
export function NoteListItem({ note, onOpen, onUpdated, onDeleteRequest }: NoteListItemProps) {
  const [title, setTitle] = useState(note.title)
  const [pending, startTransition] = useTransition()

  // Keep the input in sync when this row is refreshed from outside this
  // component (e.g. a revalidated server render after another edit).
  useEffect(() => {
    setTitle(note.title)
  }, [note.title])

  function handleBlur() {
    const trimmed = title.trim()
    if (!trimmed) {
      // Schema requires a non-empty title — revert instead of firing a
      // request that's guaranteed to fail validation.
      setTitle(note.title)
      return
    }
    if (trimmed === note.title) return

    startTransition(async () => {
      const result = await updateNoteAction({ id: note.id, title: trimmed })
      if ("error" in result) {
        toast.error(result.error)
        setTitle(note.title)
        return
      }
      onUpdated(result.data)
    })
  }

  return (
    <div
      className="flex cursor-pointer items-center gap-2.5 rounded-[12px] p-2.5 hover:bg-secondary"
      onClick={() => onOpen(note)}
      data-test={`note-row-${note.id}`}
    >
      <div className="min-w-0 flex-1">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={handleBlur}
          onClick={(event) => event.stopPropagation()}
          disabled={pending}
          aria-label="Notiztitel"
          className="h-7 border-transparent bg-transparent px-1 text-[13.5px] font-bold text-foreground hover:border-border focus-visible:border-border"
          data-test={`note-title-input-${note.id}`}
        />
        <p className="mt-0.5 px-1 text-xs text-muted-foreground">
          Zuletzt bearbeitet am {formatNoteDate(note.updated_at)}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={(event) => {
          event.stopPropagation()
          onDeleteRequest(note)
        }}
        aria-label={`„${note.title}“ löschen`}
        data-test={`note-delete-button-${note.id}`}
      >
        <Trash2 />
      </Button>
    </div>
  )
}
