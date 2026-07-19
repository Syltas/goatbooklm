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
import type { Notebook } from "@/lib/notebooks/service"

import { deleteNotebookAction } from "../actions"

interface DeleteNotebookDialogProps {
  notebook: Notebook | null
  onOpenChange: (open: boolean) => void
  onDeleted: (id: string) => void
}

export function DeleteNotebookDialog({
  notebook,
  onOpenChange,
  onDeleted,
}: DeleteNotebookDialogProps) {
  const [pending, startTransition] = useTransition()

  const onConfirm = () => {
    if (!notebook) return

    startTransition(async () => {
      const result = await deleteNotebookAction({ id: notebook.id })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Notizbuch gelöscht")
      onDeleted(notebook.id)
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={notebook !== null} onOpenChange={onOpenChange}>
      <DialogContent data-test="delete-notebook-dialog">
        <DialogHeader>
          <DialogTitle>Notizbuch löschen</DialogTitle>
          <DialogDescription>
            Möchtest du „{notebook?.title}“ wirklich löschen? Alle enthaltenen
            Quellen und der Chat-Verlauf werden unwiderruflich mitgelöscht.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              data-test="delete-notebook-cancel-button"
            >
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
            data-test="delete-notebook-confirm-button"
          >
            {pending ? "Wird gelöscht…" : "Löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
