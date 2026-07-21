"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { Note } from "@/lib/notes/service"

import { updateNoteAction } from "../actions"

interface RenameNoteDialogProps {
  note: Note | null
  onOpenChange: (open: boolean) => void
  onRenamed: (note: Note) => void
}

/**
 * Mirrors `RenameArtifactDialog` 1:1 (studio-quick-wins parity, §6 of
 * specs-v2-fixes-2.md) — same controlled-`Dialog` shape, same
 * prefill-on-`artifact`/`note`-change effect (controlled `open` jumps
 * straight to the target, so `onOpenChange(true)` never fires to prefill
 * from there), same submit/cancel affordances. Reuses the EXISTING
 * `updateNoteAction` (`../actions.ts`) — the same action `NoteEditor`'s
 * title field and the old inline list-row rename already called — rather
 * than adding a second note-title-update path; `UpdateNoteSchema.title`
 * already trims + enforces the 1..255 bound this dialog needs.
 */
export function RenameNoteDialog({ note, onOpenChange, onRenamed }: RenameNoteDialogProps) {
  const [title, setTitle] = useState("")
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (note) setTitle(note.title)
  }, [note])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!note) return
    startTransition(async () => {
      const result = await updateNoteAction({ id: note.id, title })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      onRenamed(result.data)
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={note !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-test="rename-note-dialog">
        <DialogHeader>
          <DialogTitle>Notiz umbenennen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={255}
            autoFocus
            data-test="rename-note-input"
            aria-label="Neuer Titel"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-test="rename-note-cancel"
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={pending || title.trim().length === 0}
              data-test="rename-note-save"
            >
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
