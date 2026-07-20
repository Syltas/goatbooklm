"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Note } from "@/lib/notes/service"

import { deleteNoteAction } from "../actions"

interface DeleteNoteDialogProps {
  note: Note | null
  onOpenChange: (open: boolean) => void
  onDeleted: (id: string) => void
}

/** Confirmation via `Dialog`, never a Sheet/SlideOver — project rule for
 *  destructive actions (mirrors `delete-notebook-dialog.tsx` /
 *  `delete-source-dialog.tsx`). */
export function DeleteNoteDialog({ note, onOpenChange, onDeleted }: DeleteNoteDialogProps) {
  const [pending, startTransition] = useTransition()

  function onConfirm() {
    if (!note) return

    startTransition(async () => {
      const result = await deleteNoteAction({ id: note.id })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Notiz gelöscht")
      onDeleted(note.id)
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={note !== null} onOpenChange={onOpenChange}>
      <DialogContent data-test="delete-note-dialog">
        <DialogHeader>
          <DialogTitle>Notiz löschen</DialogTitle>
          <DialogDescription>
            Möchtest du „{note?.title}“ wirklich löschen? Dieser Vorgang kann
            nicht rückgängig gemacht werden.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              data-test="delete-note-cancel-button"
            >
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
            data-test="delete-note-confirm-button"
          >
            {pending ? "Wird gelöscht…" : "Löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
