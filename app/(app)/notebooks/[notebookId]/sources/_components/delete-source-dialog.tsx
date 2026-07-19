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

import { deleteSourceAction } from "../actions"
import type { SourceWithChunkCount } from "../types"

interface DeleteSourceDialogProps {
  source: SourceWithChunkCount | null
  onOpenChange: (open: boolean) => void
  onDeleted: (sourceId: string) => void
}

export function DeleteSourceDialog({
  source,
  onOpenChange,
  onDeleted,
}: DeleteSourceDialogProps) {
  const [pending, startTransition] = useTransition()

  function onConfirm() {
    if (!source) return

    startTransition(async () => {
      const result = await deleteSourceAction({ sourceId: source.id })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Quelle gelöscht")
      onDeleted(source.id)
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={source !== null} onOpenChange={onOpenChange}>
      <DialogContent data-test="delete-source-dialog">
        <DialogHeader>
          <DialogTitle>Quelle löschen</DialogTitle>
          <DialogDescription>
            Möchtest du „{source?.title}“ wirklich löschen? Alle daraus
            erzeugten Chunks werden unwiderruflich mitgelöscht.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              data-test="delete-source-cancel-button"
            >
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
            data-test="delete-source-confirm-button"
          >
            {pending ? "Wird gelöscht…" : "Löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
