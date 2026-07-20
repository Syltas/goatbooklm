"use server"

import { revalidatePath } from "next/cache"

import { deleteChatHistorySchema } from "@/lib/chat/schema"
import { createChatHistoryService } from "@/lib/chat/service"
import { enhanceAction, type ActionResult } from "@/lib/server/action"
import { toGermanErrorMessage } from "@/lib/server/error-messages"
import { createClient } from "@/lib/supabase/server"

/**
 * Clears the whole chat transcript of one notebook (§6 Chat-Header-Menü).
 *
 * Fails closed on a notebook the caller doesn't own: RLS alone would make the
 * delete a silent no-op there, which would report "gelöscht" for someone
 * else's notebook. The explicit owner check turns that into an error instead.
 */
export const deleteChatHistoryAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ deleted: number }>> => {
    const client = await createClient()
    const service = createChatHistoryService(client)

    try {
      const notebook = await service.assertNotebookOwned(data.notebookId)
      if (!notebook) return { error: "Notizbuch nicht gefunden." }

      const deleted = await service.deleteHistory(data.notebookId, user.id)
      revalidatePath("/notebooks/[notebookId]", "page")
      return { data: { deleted } }
    } catch (error) {
      return { error: toGermanErrorMessage(error, "chat-history-action") }
    }
  },
  { auth: true, schema: deleteChatHistorySchema }
)
