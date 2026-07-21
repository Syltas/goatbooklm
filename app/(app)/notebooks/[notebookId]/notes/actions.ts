"use server"

import { revalidatePath } from "next/cache"

import {
  EmptyNoteError,
  NoteTooLongForSourceError,
  prepareNoteSourceText,
} from "@/lib/notes/convert-to-source"
import {
  ConvertNoteToSourceSchema,
  CreateNoteSchema,
  DeleteNoteSchema,
  SaveTextAsNoteSchema,
  UpdateNoteSchema,
} from "@/lib/notes/schema"
import { plainTextToNoteContent } from "@/lib/notes/serialize"
import { createNoteService, type Note } from "@/lib/notes/service"
import { createIngestionDeps } from "@/lib/ingestion/deps"
import { INGESTION_MESSAGES } from "@/lib/ingestion/messages"
import { createIngestionService, DuplicateSourceError, type Source } from "@/lib/ingestion/service"
import { enhanceAction, type ActionResult } from "@/lib/server/action"
import { toGermanErrorMessage } from "@/lib/server/error-messages"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

function getErrorMessage(error: unknown) {
  return toGermanErrorMessage(error, "notes-action")
}

// Same "known, already-German message" passthrough as
// `sources/actions.ts`'s own `getErrorMessage` — duplicated rather than
// imported from there, since that file is `'use server'` (only async
// function exports allowed, no shared helper to import) and this action
// is the only one in this file that ever calls into the ingestion layer.
const KNOWN_INGESTION_MESSAGES = new Set<string>(Object.values(INGESTION_MESSAGES))

function getIngestionErrorMessage(error: unknown): string {
  if (error instanceof DuplicateSourceError) {
    console.error("[convert-note-to-source-action]", error)
    return error.message
  }
  if (error instanceof Error && KNOWN_INGESTION_MESSAGES.has(error.message)) {
    console.error("[convert-note-to-source-action]", error)
    return error.message
  }
  return toGermanErrorMessage(error, "convert-note-to-source-action")
}

const NOTEBOOK_DETAIL_PATH = "/notebooks/[notebookId]"

/**
 * Creates an empty note ("Notiz hinzufügen" has no form — see
 * `lib/notes/schema.ts`). Fails closed on a notebook the caller doesn't
 * own: RLS's `with check` would reject the insert anyway, but that surfaces
 * as a raw Postgres RLS error instead of the same "Notizbuch nicht
 * gefunden." message every other action in this codebase uses for this
 * case (mirrors `deleteChatHistoryAction`'s `assertNotebookOwned` check).
 */
export const createNoteAction = enhanceAction(
  async (data, user): Promise<ActionResult<Note>> => {
    const client = await createClient()
    const service = createNoteService(client)

    try {
      const notebook = await service.assertNotebookOwned(data.notebookId)
      if (!notebook) return { error: "Notizbuch nicht gefunden." }

      const note = await service.create({ notebookId: data.notebookId, userId: user.id })
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: note }
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  },
  { auth: true, schema: CreateNoteSchema }
)

/**
 * "Als Notiz speichern" — the empty-chat notebook summary (Part A) and an
 * assistant answer's end-of-turn action (Part B) both call this, unlike
 * `createNoteAction` which always starts empty. Reuses the SAME
 * create-then-update path those two actions each expose individually
 * (`service.create` + `service.update`), rather than a new insert shape.
 *
 * The note is flagged `origin='chat'` and keeps its raw markdown + citation
 * details, so the studio panel renders it read-only with the chat's exact
 * markdown + interactive citation-chip stack (`note-viewer.tsx`) instead of the
 * plaintext-flattened TipTap editor it used to get. `content` is STILL
 * populated (a plaintext projection of the markdown via `plainTextToNoteContent`)
 * so the downstream "Zu Quelle machen" path — which reads `notes.content` —
 * keeps working unchanged for a chat note too.
 *
 * Fails closed on a notebook the caller doesn't own, same reasoning as
 * `createNoteAction` above.
 */
export const saveTextAsNoteAction = enhanceAction(
  async (data, user): Promise<ActionResult<Note>> => {
    const client = await createClient()
    const service = createNoteService(client)

    try {
      const notebook = await service.assertNotebookOwned(data.notebookId)
      if (!notebook) return { error: "Notizbuch nicht gefunden." }

      const created = await service.create({ notebookId: data.notebookId, userId: user.id })
      const note = await service.update(
        created.id,
        {
          title: data.title,
          content: plainTextToNoteContent(data.text),
          origin: "chat",
          markdown: data.text,
          citations: data.citations ?? [],
        },
        user.id
      )
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: note }
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  },
  { auth: true, schema: SaveTextAsNoteSchema }
)

/**
 * Fails closed on someone else's (or a nonexistent) note: RLS alone would
 * make the update a silent no-op there, which would report "gespeichert"
 * for a note that never existed. The explicit `getById` check turns that
 * into an error instead (same reasoning as `deleteChatHistoryAction`).
 *
 * `title`/`content` are both optional on the input (`UpdateNoteSchema`
 * requires at least one) — passed straight through to the service, which
 * only touches the fields actually present.
 */
export const updateNoteAction = enhanceAction(
  async (data, user): Promise<ActionResult<Note>> => {
    const client = await createClient()
    const service = createNoteService(client)

    try {
      const existing = await service.getById(data.id)
      if (!existing) return { error: "Notiz nicht gefunden." }

      const note = await service.update(
        data.id,
        { title: data.title, content: data.content },
        user.id
      )
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: note }
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  },
  { auth: true, schema: UpdateNoteSchema }
)

/**
 * Same fail-closed reasoning as `updateNoteAction` — without the explicit
 * `getById` check, deleting a foreign/nonexistent note would silently
 * affect 0 rows and still report "gelöscht" to the caller.
 */
export const deleteNoteAction = enhanceAction(
  async (data, user): Promise<ActionResult<{ success: true }>> => {
    const client = await createClient()
    const service = createNoteService(client)

    try {
      const existing = await service.getById(data.id)
      if (!existing) return { error: "Notiz nicht gefunden." }

      await service.delete(data.id, user.id)
      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: { success: true } }
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  },
  { auth: true, schema: DeleteNoteSchema }
)

/**
 * "Zu Quelle machen": runs a note's content through the exact same
 * ingestion path a pasted-text source takes (`createTextSource` —
 * `lib/ingestion/service.ts`), so the resulting `sources` row goes through
 * the same `pending -> processing -> ready` lifecycle, chunking and
 * embedding as every other text source. No parallel/short-circuit path.
 *
 * This is a ONE-TIME snapshot, not a link: the note keeps existing
 * unchanged after this runs, and nothing here stores a reference back to
 * it (no `note_id` column on `sources`, deliberately). A later edit to the
 * note does NOT update the source it produced — if you're reading this
 * because you're about to wire up a "keep them in sync" feature, that's a
 * new, separate feature (re-running this conversion, or a real
 * note<->source link with its own invalidation story), not a bug fix here.
 *
 * `title`/`notebookId`/`text` are all derived from the loaded note, never
 * accepted as action input (`ConvertNoteToSourceSchema` only takes the
 * note id) — same "never trust client-supplied ownership/content" rule as
 * every other action in this codebase.
 */
export const convertNoteToSourceAction = enhanceAction(
  async (data, user): Promise<ActionResult<Source>> => {
    const client = await createClient()
    const noteService = createNoteService(client)

    try {
      const note = await noteService.getById(data.id)
      if (!note) return { error: "Notiz nicht gefunden." }

      let text: string
      try {
        text = prepareNoteSourceText(note.content)
      } catch (error) {
        // Defense in depth: the editor already disables the button for an
        // empty note and the button's own click handler never fires this
        // action past the length cap either, but the action itself must
        // not trust the client caught these — a stale page, a second tab,
        // or a direct call could still reach here.
        if (error instanceof EmptyNoteError || error instanceof NoteTooLongForSourceError) {
          return { error: error.message }
        }
        throw error
      }

      // See processSourceAction/addTextSourceAction in
      // sources/actions.ts — the row insert itself stays RLS-scoped
      // (`client`), only the enqueue RPC needs the admin client.
      // Constructed inside this try since `createAdminClient()` itself can
      // throw (a missing `SUPABASE_SERVICE_ROLE_KEY`).
      const ingestionService = createIngestionService(
        createIngestionDeps(client, { enqueueClient: createAdminClient() })
      )

      const source = await ingestionService.createTextSource({
        notebookId: note.notebook_id,
        userId: user.id,
        title: note.title,
        text,
      })

      revalidatePath(NOTEBOOK_DETAIL_PATH, "page")
      return { data: source }
    } catch (error) {
      return { error: getIngestionErrorMessage(error) }
    }
  },
  { auth: true, schema: ConvertNoteToSourceSchema }
)
