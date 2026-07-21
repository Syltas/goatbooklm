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
 * One `CitationDetail` (see `lib/chat/types.ts`) as it arrives from the client
 * — the chat answer's `data-citations` message part, passed through so a saved
 * chat note can render the SAME interactive citation chips the chat does.
 *
 * This is pure DISPLAY data, not a trust boundary: it only ever renders inside
 * the saving user's own note (RLS-scoped), and clicking a chip calls
 * `openSource(sourceId)`, which the reader resolves under RLS — a forged
 * `sourceId` can't reach another user's source. So a loose-but-shaped validate
 * (right fields, right types) is enough; we don't re-resolve every citation
 * against the DB on save. `.passthrough()`-free `.strict()` is avoided on
 * purpose — a future extra field on `CitationDetail` must not hard-fail an
 * older client's save — but unknown keys are dropped rather than stored.
 */
const CitationDetailSchema = z.object({
  n: z.number().int().nonnegative(),
  chunkId: z.string().nullable(),
  sourceId: z.uuid(),
  sourceTitle: z.string(),
  sourceType: z.string(),
  content: z.string(),
  charStart: z.number().int().nonnegative().optional(),
  charEnd: z.number().int().nonnegative().optional(),
  page: z.number().int().optional(),
  paragraph: z.number().int().optional(),
})

/**
 * Input for `saveTextAsNoteAction` ("Als Notiz speichern" — the empty-chat
 * notebook summary, Part A, and an assistant answer's end-of-turn action,
 * Part B). `text` is the raw chat markdown (a chat answer with `[n]` citation
 * markers left in, or the notebook summary). It is stored verbatim as the
 * note's `markdown` and the note is flagged `origin='chat'`, so it renders
 * read-only with the chat's markdown + citation-chip stack instead of the
 * TipTap editor (`content` is still populated as a plaintext projection for
 * the "Zu Quelle machen" path — see the action).
 *
 * `citations` is optional: the notebook summary has none, an answer carries
 * its `data-citations`. `.optional()` (not `.default([])`) so a caller with no
 * citations — the summary — doesn't have to pass the field at all; the action
 * normalizes a missing value to `[]`.
 */
export const SaveTextAsNoteSchema = z.object({
  notebookId: z.uuid("Ungültige Notizbuch-ID"),
  title: z.string().trim().min(1).max(255),
  text: z.string().trim().min(1, "Kein Text zum Speichern vorhanden."),
  citations: z.array(CitationDetailSchema).optional(),
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
