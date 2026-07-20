import { noteContentToPlainText } from "./serialize"

/**
 * Mirrors `AddTextSourceSchema`'s cap (`lib/ingestion/schema.ts`) — kept as
 * its own constant rather than importing that Zod schema here, since this
 * module (like `serialize.ts`) is meant to stay framework/layer-agnostic
 * (imported from both the "Zu Quelle machen" server action and, for the
 * button's disabled state, the client-side note editor) and importing a
 * schema module would blur that line. If the ingestion cap ever changes,
 * this constant must change with it.
 */
export const NOTE_SOURCE_MAX_CHARS = 500_000

/** Thrown by `prepareNoteSourceText` for a note with no text at all —
 *  see that function's doc comment for why this check has to run before
 *  any `sources` row exists. */
export class EmptyNoteError extends Error {
  constructor() {
    super("Diese Notiz ist leer und kann nicht in eine Quelle umgewandelt werden.")
    this.name = "EmptyNoteError"
  }
}

/** Thrown by `prepareNoteSourceText` when the note's serialized text
 *  exceeds `NOTE_SOURCE_MAX_CHARS` — see that function's doc comment. */
export class NoteTooLongForSourceError extends Error {
  constructor() {
    super(
      "Diese Notiz ist zu lang für eine Quelle (mehr als 500.000 Zeichen). Kürze sie zuerst."
    )
    this.name = "NoteTooLongForSourceError"
  }
}

/** Read-only check for the editor's "Zu Quelle machen" button — disabled
 *  for an empty note without needing to run (and catch) the throwing
 *  guard below just to test one branch of it. */
export function isNoteContentEmpty(content: unknown): boolean {
  return noteContentToPlainText(content).length === 0
}

/**
 * Guards + serializes a note's TipTap `content` into the plaintext that
 * becomes the resulting source's `content_text` — shared by
 * `convertNoteToSourceAction` and its unit tests, so the "empty"/"too
 * long" checks are exercised without a Supabase client.
 *
 * Both checks run BEFORE any `sources` row is created (rather than letting
 * `createTextSource`/`AddTextSourceSchema` reject them): an empty note
 * would otherwise still create a `pending` row, get enqueued, and only
 * fail visibly once the worker's `noReadableText` guard rejects it
 * (`lib/ingestion/service.ts`) — a detour through the queue for a failure
 * that's knowable synchronously up front, ending as a red error-source
 * instead of never being created at all. The length cap is duplicated
 * here (not just left to `AddTextSourceSchema`) so the message names the
 * *note* as too long, not a generic "Text"-field schema error.
 */
export function prepareNoteSourceText(content: unknown): string {
  const text = noteContentToPlainText(content)
  if (text.length === 0) throw new EmptyNoteError()
  if (text.length > NOTE_SOURCE_MAX_CHARS) throw new NoteTooLongForSourceError()
  return text
}
