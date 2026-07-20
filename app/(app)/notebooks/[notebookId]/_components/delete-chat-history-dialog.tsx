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

import { deleteChatHistoryAction } from "../actions"

interface DeleteChatHistoryDialogProps {
  notebookId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the server delete succeeded, so the client-held transcript
   *  can be cleared too (the `useChat` message list is not RSC state). */
  onDeleted: () => void
}

export function DeleteChatHistoryDialog({
  notebookId,
  open,
  onOpenChange,
  onDeleted,
}: DeleteChatHistoryDialogProps) {
  const [pending, startTransition] = useTransition()

  const onConfirm = () => {
    startTransition(async () => {
      const result = await deleteChatHistoryAction({ notebookId })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Chatverlauf gelöscht")
      onDeleted()
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-test="delete-chat-history-dialog">
        <DialogHeader>
          <DialogTitle>Chatverlauf löschen</DialogTitle>
          <DialogDescription>
            Alle Fragen und Antworten in diesem Notizbuch werden unwiderruflich
            gelöscht. Ihre Quellen bleiben erhalten.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              data-test="delete-chat-history-cancel-button"
            >
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
            data-test="delete-chat-history-confirm-button"
          >
            {pending ? "Wird gelöscht…" : "Löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
