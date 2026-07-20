"use server"

import { revalidatePath } from "next/cache"

import { enhanceAction, type ActionResult } from "@/lib/server/action"
import { toGermanErrorMessage } from "@/lib/server/error-messages"
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
  async (data): Promise<ActionResult<{ success: true }>> => {
    const client = await createClient()
    const service = createStudioService({ db: client })

    try {
      await service.deleteArtifact(data.artifactId)
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: { success: true } }
    } catch (error) {
      return { error: toGermanErrorMessage(error, "delete-studio-artifact-action") }
    }
  },
  { auth: true, schema: DeleteStudioArtifactSchema }
)
