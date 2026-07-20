import { z } from "zod"

/**
 * Input for `createNoteAction`. Notes start empty (no create-form, unlike
 * notebooks — the title is edited inline afterwards) — the only client
 * input is which notebook it belongs to. `user_id` is never accepted here;
 * it's resolved server-side from the session (`enhanceAction`'s `user`).
 */
export const CreateNoteSchema = z.object({
  notebookId: z.uuid("Ungültige Notizbuch-ID"),
})

/**
 * TipTap JSON doc — validated only loosely (a plain object) since its
 * shape is owned by whichever TipTap extensions are active client-side,
 * not by this schema; the DB column is `jsonb` regardless. Still rejects
 * arrays and primitives, which a real `editor.getJSON()` call never
 * produces (see `lib/notes/serialize.ts`).
 */
const NoteContentSchema = z.record(z.string(), z.unknown())

/**
 * `title` and `content` are both optional — the editor autosaves them
 * independently (content on every debounce tick regardless of whether the
 * title changed, the title-only list-item rename never touches content),
 * so requiring both would force one call site to resend a value it never
 * read. The `refine` below still rejects a call with neither, which would
 * otherwise be a no-op update that reports "gespeichert" for nothing.
 */
export const UpdateNoteSchema = z
  .object({
    id: z.uuid("Ungültige Notiz-ID"),
    title: z
      .string()
      .trim()
      .min(1, "Titel ist erforderlich")
      .max(255, "Titel darf höchstens 255 Zeichen lang sein")
      .optional(),
    content: NoteContentSchema.optional(),
  })
  .refine((data) => data.title !== undefined || data.content !== undefined, {
    message: "Keine Änderungen zum Speichern übergeben.",
  })

export const DeleteNoteSchema = z.object({
  id: z.uuid("Ungültige Notiz-ID"),
})

/**
 * Input for `saveTextAsNoteAction` ("Als Notiz speichern" — the empty-chat
 * notebook summary, Part A, and an assistant answer's end-of-turn action,
 * Part B). `text` is already-plain text (a chat answer with citation markers
 * left in as-is, or the notebook summary) — converted to TipTap JSON
 * server-side via `plainTextToNoteContent` (`lib/notes/serialize.ts`), never
 * accepted as pre-built TipTap JSON from the client.
 */
export const SaveTextAsNoteSchema = z.object({
  notebookId: z.uuid("Ungültige Notizbuch-ID"),
  title: z.string().trim().min(1).max(255),
  text: z.string().trim().min(1, "Kein Text zum Speichern vorhanden."),
})

/** Input for `convertNoteToSourceAction` ("Zu Quelle machen") — only the
 *  note id; notebook, title and text are all derived server-side from the
 *  loaded note, never accepted from the client (see that action's
 *  comment). */
export const ConvertNoteToSourceSchema = z.object({
  id: z.uuid("Ungültige Notiz-ID"),
})

export type CreateNoteInput = z.infer<typeof CreateNoteSchema>
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>
export type DeleteNoteInput = z.infer<typeof DeleteNoteSchema>
export type ConvertNoteToSourceInput = z.infer<typeof ConvertNoteToSourceSchema>
export type SaveTextAsNoteInput = z.infer<typeof SaveTextAsNoteSchema>
