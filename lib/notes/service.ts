import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import type { Database, Json } from "@/lib/database.types"

export type Note = Database["public"]["Tables"]["notes"]["Row"]

const uuidSchema = z.uuid()

/** Notes have no create-form (unlike notebooks) — "Notiz hinzufügen" just
 *  inserts an empty one, title editable inline right after. Also the DB
 *  column's own default, so a row created outside this service (migration,
 *  seed, admin client) never ends up titleless either. */
export const DEFAULT_NOTE_TITLE = "Neue Notiz"

/**
 * Pure notes service — the Supabase client is injected, never imported, so
 * the same logic runs from a Server Action or a test with a stub client
 * (mirrors `lib/notebooks/service.ts` / `createChatHistoryService` in
 * `lib/chat/service.ts`).
 *
 * "Trust RLS": every method that already scopes by `id` relies on the
 * `notes_owner` RLS policy (`auth.uid() = user_id`) for access control, not
 * a redundant manual `.eq("user_id", ...)` filter. `userId` stays in
 * `update`/`delete` signatures for interface symmetry with `create` (which
 * does need it to stamp ownership) and so future callers (audit logging)
 * have it available.
 */
export function createNoteService(client: SupabaseClient<Database>) {
  return new NoteService(client)
}

class NoteService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Owner-check for a notebook (identical in spirit to
   * `ChatService.assertNotebookOwned` / `createChatHistoryService`'s
   * method of the same name): RLS scopes `notebooks` to their owner, so "a
   * foreign notebook" and "no such notebook" are indistinguishable here —
   * both resolve to `null`, and the caller (the create action) must fail
   * closed on that instead of letting the insert hit `notes_owner`'s
   * `with check` and surface as a raw Postgres RLS error.
   */
  async assertNotebookOwned(notebookId: string): Promise<{ id: string } | null> {
    if (!uuidSchema.safeParse(notebookId).success) return null

    const { data, error } = await this.client
      .from("notebooks")
      .select("id")
      .eq("id", notebookId)
      .maybeSingle()

    if (error) throw error
    return data
  }

  async create(data: { notebookId: string; userId: string }): Promise<Note> {
    const { data: note, error } = await this.client
      .from("notes")
      .insert({
        notebook_id: data.notebookId,
        user_id: data.userId,
        title: DEFAULT_NOTE_TITLE,
      })
      .select()
      .single()

    if (error) throw error
    return note
  }

  /** Notes of one notebook, most-recently-edited first — `updated_at` is
   *  the sort key, same "zuletzt bearbeitet" convention as the notebooks
   *  list uses for "zuletzt verwendet". */
  async list(notebookId: string): Promise<Note[]> {
    const { data, error } = await this.client
      .from("notes")
      .select("*")
      .eq("notebook_id", notebookId)
      .order("updated_at", { ascending: false })

    if (error) throw error
    return data ?? []
  }

  /**
   * Doubles as the owner-check for `update`/`delete` (same pattern as
   * `assertNotebookOwned` above): a malformed id resolves to `null` without
   * querying — PostgREST would otherwise throw "invalid input syntax for
   * type uuid", an unhandled 500 instead of the caller's expected
   * not-found — and a foreign or nonexistent id is `null` too, since RLS
   * makes the two indistinguishable.
   */
  async getById(id: string): Promise<Note | null> {
    if (!uuidSchema.safeParse(id).success) return null

    const { data, error } = await this.client
      .from("notes")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    if (error) throw error
    return data
  }

  /**
   * Partial update: `title` and `content` are each optional (see
   * `UpdateNoteSchema`) since the editor autosaves `content` on every
   * debounce tick regardless of whether the title changed, and the
   * list-item's blur-triggered rename never touches `content` — sending
   * only the fields that were actually provided avoids clobbering the
   * other with a stale value the caller never read.
   */
  async update(
    id: string,
    data: { title?: string; content?: Record<string, unknown> },
    userId: string
  ): Promise<Note> {
    void userId

    if (!uuidSchema.safeParse(id).success) {
      throw new Error("Notiz nicht gefunden")
    }

    const patch: Database["public"]["Tables"]["notes"]["Update"] = {}
    if (data.title !== undefined) patch.title = data.title
    if (data.content !== undefined) {
      // `data.content` is already validated as a plain object by
      // `UpdateNoteSchema` (a Zod `Record<string, unknown>`, not a full
      // TipTap schema). Supabase's generated `Json` union can't
      // structurally match that Zod output type even though every value
      // `editor.getJSON()` ever produces — plain objects/arrays/strings/
      // numbers/booleans/null — is always valid JSON.
      patch.content = data.content as Json
    }

    const { data: note, error } = await this.client
      .from("notes")
      .update(patch)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return note
  }

  async delete(id: string, userId: string): Promise<void> {
    void userId

    if (!uuidSchema.safeParse(id).success) {
      throw new Error("Notiz nicht gefunden")
    }

    const { error } = await this.client.from("notes").delete().eq("id", id)

    if (error) throw error
  }
}
