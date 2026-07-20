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
import type { StudioArtifact } from "@/lib/studio/service"

import { renameStudioArtifactAction } from "../actions"

interface RenameArtifactDialogProps {
  artifact: StudioArtifact | null
  onOpenChange: (open: boolean) => void
  onRenamed: (artifact: StudioArtifact) => void
}

export function RenameArtifactDialog({
  artifact,
  onOpenChange,
  onRenamed,
}: RenameArtifactDialogProps) {
  const [title, setTitle] = useState("")
  const [pending, startTransition] = useTransition()

  // Controlled Dialog: `open` springt direkt mit `artifact` um — der Titel
  // muss daher hier vorbefüllt werden, nicht im onOpenChange(true)-Pfad
  // (der bei controlled open nie feuert).
  useEffect(() => {
    if (artifact) setTitle(artifact.title)
  }, [artifact])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!artifact) return
    startTransition(async () => {
      const result = await renameStudioArtifactAction({
        artifactId: artifact.id,
        title,
      })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      onRenamed(result.data)
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={artifact !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-test="rename-artifact-dialog">
        <DialogHeader>
          <DialogTitle>Bericht umbenennen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={255}
            autoFocus
            data-test="rename-artifact-input"
            aria-label="Neuer Titel"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-test="rename-artifact-cancel"
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={pending || title.trim().length === 0}
              data-test="rename-artifact-save"
            >
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
