"use server"

import { revalidatePath } from "next/cache"

import { enhanceAction, type ActionResult } from "@/lib/server/action"
import { toGermanErrorMessage } from "@/lib/server/error-messages"
import { parseAudioContent } from "@/lib/studio/audio-schema"
import {
  DeleteStudioArtifactSchema,
  RenameStudioArtifactSchema,
} from "@/lib/studio/schema"
import { createStudioService, type StudioArtifact } from "@/lib/studio/service"
import { createClient } from "@/lib/supabase/server"

const NOTEBOOK_DETAIL_PATH = "/notebooks/[notebookId]"

// Kein create hier — Reports entstehen ausschließlich über die
// Streaming-Route `app/api/studio/generate` (Spec "Server Actions").

export const renameStudioArtifactAction = enhanceAction(
  async (data): Promise<ActionResult<StudioArtifact>> => {
    const client = await createClient()
    const service = createStudioService({ db: client })

    try {
      // RLS scoped: fremde/nicht existierende IDs treffen 0 Rows → null.
      const artifact = await service.renameArtifact({
        artifactId: data.artifactId,
        title: data.title,
      })
      if (!artifact) {
        return { error: "Bericht nicht gefunden." }
      }
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: artifact }
    } catch (error) {
      return { error: toGermanErrorMessage(error, "rename-studio-artifact-action") }
    }
  },
  { auth: true, schema: RenameStudioArtifactSchema }
)

export const deleteStudioArtifactAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ success: true }>> => {
    const client = await createClient()
    const service = createStudioService({ db: client })

    try {
      // Audio-Artefakte tragen Storage-Objekte. L1-Reihenfolge
      // (docs/specs/studio-audio.md, Review-Fix R1-1): Pfade ERST einsammeln,
      // dann Row löschen, dann Storage — ein fehlgeschlagener Row-Delete darf
      // nie eine Row hinterlassen, die auf eine gelöschte Datei zeigt.
      const storagePaths: string[] = []
      const artifact = await service.getOwnedArtifact(data.artifactId)
      if (artifact?.type === "audio") {
        const content = parseAudioContent(artifact.content)
        if (content?.storage_path) storagePaths.push(content.storage_path)
        // Evtl. liegengebliebene Segmente einer failed/abgebrochenen
        // Generierung (RLS-select-Policy deckt das list).
        const segmentPrefix = `${user.id}/${artifact.id}/segments`
        const { data: segments } = await client.storage
          .from("studio-audio")
          .list(segmentPrefix)
        for (const object of segments ?? []) {
          storagePaths.push(`${segmentPrefix}/${object.name}`)
        }
      }

      await service.deleteArtifact(data.artifactId)

      if (storagePaths.length > 0) {
        const { error: storageError } = await client.storage
          .from("studio-audio")
          .remove(storagePaths)
        if (storageError) {
          // Orphan-Objekt statt kaputter Row — geloggt, nicht fatal.
          console.error("[delete-studio-artifact] storage cleanup failed", storageError)
        }
      }

      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: { success: true } }
    } catch (error) {
      return { error: toGermanErrorMessage(error, "delete-studio-artifact-action") }
    }
  },
  { auth: true, schema: DeleteStudioArtifactSchema }
)
