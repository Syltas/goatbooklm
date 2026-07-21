"use server"

import { revalidatePath } from "next/cache"

import { createIngestionDeps } from "@/lib/ingestion/deps"
import { createIngestionService } from "@/lib/ingestion/service"
import { enhanceAction, type ActionResult } from "@/lib/server/action"
import { toGermanErrorMessage } from "@/lib/server/error-messages"
import { createClient } from "@/lib/supabase/server"
import {
  CreateNotebookSchema,
  DeleteNotebookSchema,
  UpdateNotebookSchema,
} from "@/lib/notebooks/schema"
import { createNotebookService, type Notebook } from "@/lib/notebooks/service"

function getErrorMessage(error: unknown) {
  return toGermanErrorMessage(error, "notebooks-action")
}

/** Alle studio-audio-Objekte der Audio-Artefakte eines Notebooks (finale
 *  MP3s + evtl. liegengebliebene Segmente) — RLS-scoped gelesen. */
async function collectStudioAudioPaths(
  client: Awaited<ReturnType<typeof createClient>>,
  notebookId: string,
  userId: string
): Promise<string[]> {
  const { data: rows, error } = await client
    .from("studio_artifacts")
    .select("id, content")
    .eq("notebook_id", notebookId)
    .eq("type", "audio")
  if (error || !rows) return []

  const paths: string[] = []
  for (const row of rows) {
    const storagePath = (row.content as { storage_path?: string } | null)?.storage_path
    if (storagePath) paths.push(storagePath)
    const segmentPrefix = `${userId}/${row.id}/segments`
    const { data: segments } = await client.storage
      .from("studio-audio")
      .list(segmentPrefix)
    for (const object of segments ?? []) {
      paths.push(`${segmentPrefix}/${object.name}`)
    }
  }
  return paths
}

export const createNotebookAction = enhanceAction(
  async (data, user): Promise<ActionResult<Notebook>> => {
    const client = await createClient()
    const service = createNotebookService(client)

    try {
      const notebook = await service.create({ ...data, userId: user.id })
      revalidatePath("/notebooks")
      return { data: notebook }
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  },
  { auth: true, schema: CreateNotebookSchema }
)

export const updateNotebookAction = enhanceAction(
  async (data, user): Promise<ActionResult<Notebook>> => {
    const client = await createClient()
    const service = createNotebookService(client)
    const { id, ...rest } = data

    try {
      const notebook = await service.update(id, rest, user.id)
      revalidatePath("/notebooks")
      revalidatePath("/notebooks/[notebookId]", "page")
      return { data: notebook }
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  },
  { auth: true, schema: UpdateNotebookSchema }
)

export const deleteNotebookAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ success: true }>> => {
    const client = await createClient()
    const service = createNotebookService(client)
    const ingestionService = createIngestionService(createIngestionDeps(client))

    try {
      // Storage-Cleanup (Spec 02 §9/§14, Eng-Review L1): read the
      // storage_paths of every file-backed source BEFORE the notebook row (and its cascaded `sources`
      // rows) are deleted — the storage_path values are only readable while
      // those rows still exist — but only actually delete the Storage
      // objects AFTER the DB delete has succeeded. This ordering means a
      // failure between the two steps can only ever leave a harmless
      // orphaned Storage object (no row references it), never a `sources`
      // row pointing at an already-deleted file. The Storage delete itself
      // is best-effort (logs per-object failures internally, never throws),
      // so it can't block the notebook deletion the user is waiting on.
      const storagePaths = await ingestionService.getNotebookStoragePaths({
        notebookId: data.id,
        userId: user.id,
      })
      // Gleiches L1-Ordering für Audio-Artefakte (docs/specs/studio-audio.md,
      // Review-Fix R1-5): studio-audio-Pfade einsammeln, solange die
      // studio_artifacts-Rows noch existieren; gelöscht wird erst nach dem
      // DB-Delete, best-effort.
      const audioPaths = await collectStudioAudioPaths(client, data.id, user.id)
      await service.delete(data.id, user.id)
      await ingestionService.deleteStorageObjects(storagePaths)
      if (audioPaths.length > 0) {
        const { error: audioCleanupError } = await client.storage
          .from("studio-audio")
          .remove(audioPaths)
        if (audioCleanupError) {
          console.error("[delete-notebook] studio-audio cleanup failed", audioCleanupError)
        }
      }
      revalidatePath("/notebooks")
      revalidatePath("/notebooks/[notebookId]", "page")
      return { data: { success: true } }
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  },
  { auth: true, schema: DeleteNotebookSchema }
)
