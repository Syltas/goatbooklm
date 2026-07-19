import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import type { Database } from "@/lib/database.types"

import type { CreateNotebookInput } from "./schema"

export type Notebook = Database["public"]["Tables"]["notebooks"]["Row"]

const uuidSchema = z.uuid()

/**
 * Pure notebook service — the Supabase client is injected, never imported,
 * so the same logic works from a Server Action, a Route Handler, or a test
 * with a stub client (see `service-builder`/`server-action-builder` skills).
 *
 * "Trust RLS" (Annahme 6, specs/01-notebooks.md): every method below takes
 * `userId`, but only `create()` actually uses it (to stamp ownership on
 * insert). `list`/`getById`/`update`/`delete` rely exclusively on the
 * `notebooks_owner` RLS policy (`auth.uid() = user_id`) for access control —
 * no redundant manual `.eq("user_id", ...)` filter. `userId` stays in the
 * signature for interface symmetry with `create` and so future callers
 * (audit logging, service-role contexts) have it available.
 */
export function createNotebookService(client: SupabaseClient<Database>) {
  return new NotebookService(client)
}

class NotebookService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async create(
    data: CreateNotebookInput & { userId: string }
  ): Promise<Notebook> {
    const { data: notebook, error } = await this.client
      .from("notebooks")
      .insert({
        title: data.title,
        description: normalizeDescription(data.description),
        user_id: data.userId,
      })
      .select()
      .single()

    if (error) throw error
    return notebook
  }

  async list(userId: string): Promise<Notebook[]> {
    void userId

    const { data, error } = await this.client
      .from("notebooks")
      .select("*")
      // "Zuletzt verwendet" (AC-44): updated_at ist der Proxy für
      // "zuletzt verwendet" — es gibt kein eigenes Last-Opened-Tracking in
      // v1 (Annahme 1/14, specs/01-notebooks.md).
      .order("updated_at", { ascending: false })

    if (error) throw error
    return data ?? []
  }

  /**
   * Liefert `null` bei einer syntaktisch ungültigen (Nicht-UUID) id, OHNE
   * zu queryen — PostgREST würde sonst "invalid input syntax for type uuid"
   * werfen, was unbehandelt zu einem 500 statt der von der Route
   * erwarteten 404 führen würde (Eng-Review 2026-07-19, OV9).
   */
  async getById(id: string, userId: string): Promise<Notebook | null> {
    void userId

    if (!uuidSchema.safeParse(id).success) return null

    const { data, error } = await this.client
      .from("notebooks")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    if (error) throw error
    return data
  }

  async update(
    id: string,
    data: Partial<CreateNotebookInput>,
    userId: string
  ): Promise<Notebook> {
    void userId

    if (!uuidSchema.safeParse(id).success) {
      throw new Error("Notizbuch nicht gefunden")
    }

    const payload: { title?: string; description?: string | null } = {}
    if (data.title !== undefined) payload.title = data.title
    if (data.description !== undefined) {
      payload.description = normalizeDescription(data.description)
    }

    const { data: notebook, error } = await this.client
      .from("notebooks")
      .update(payload)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return notebook
  }

  async delete(id: string, userId: string): Promise<void> {
    void userId

    if (!uuidSchema.safeParse(id).success) {
      throw new Error("Notizbuch nicht gefunden")
    }

    const { error } = await this.client
      .from("notebooks")
      .delete()
      .eq("id", id)

    if (error) throw error
  }
}

function normalizeDescription(description: string | undefined): string | null {
  const trimmed = description?.trim()
  return trimmed ? trimmed : null
}
