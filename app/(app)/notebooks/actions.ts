"use server"

import { revalidatePath } from "next/cache"

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

    try {
      await service.delete(data.id, user.id)
      revalidatePath("/notebooks")
      revalidatePath("/notebooks/[notebookId]", "page")
      return { data: { success: true } }
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  },
  { auth: true, schema: DeleteNotebookSchema }
)
