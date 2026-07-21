"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { STUDIO_TYPE_META } from "@/lib/studio/format-meta"
import type { GeneratableType } from "@/lib/studio/schema"
import type { StudioArtifact } from "@/lib/studio/service"

import { deleteStudioArtifactAction } from "../actions"

function typeLabel(artifact: StudioArtifact | null): string {
  if (!artifact) return "Artefakt"
  return STUDIO_TYPE_META[artifact.type as GeneratableType]?.label ?? "Artefakt"
}

interface DeleteArtifactDialogProps {
  artifact: StudioArtifact | null
  onOpenChange: (open: boolean) => void
  onDeleted: (artifactId: string) => void
}

export function DeleteArtifactDialog({
  artifact,
  onOpenChange,
  onDeleted,
}: DeleteArtifactDialogProps) {
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!artifact) return
    startTransition(async () => {
      const result = await deleteStudioArtifactAction({ artifactId: artifact.id })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      onDeleted(artifact.id)
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={artifact !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-test="delete-artifact-dialog">
        <DialogHeader>
          <DialogTitle>{`${typeLabel(artifact)} löschen?`}</DialogTitle>
          <DialogDescription>
            „{artifact?.title}“ wird dauerhaft gelöscht. Das kann nicht rückgängig
            gemacht werden.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-test="delete-artifact-cancel"
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={pending}
            data-test="delete-artifact-confirm"
          >
            Löschen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
