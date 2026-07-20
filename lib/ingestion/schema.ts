import { z } from "zod"

import { MAX_UPLOAD_BYTES } from "./formats"

/**
 * Zod schemas for the ingestion feature (specs/02-ingestion.md §9). These
 * validate Server Action input at the adapter layer (`enhanceAction({
 * schema })`) — the service layer itself does not re-validate, matching the
 * convention in `lib/notebooks/service.ts`.
 */

/**
 * Input for creating any file-backed source, of any supported format.
 *
 * Note what this schema deliberately does NOT accept: a source type. The
 * previous `fileMimeType: z.literal("application/pdf")` both validated the
 * upload and implied its type, which does not generalize — a client could
 * simply declare a type and pick the extraction head. The action resolves
 * the type server-side from `fileName` + `fileMimeType` via
 * `detectFileFormat` instead, the same rule that keeps `userId` server-side.
 *
 * `fileSizeBytes` is only the coarse upper bound across all formats here;
 * the per-format cap is enforced in the worker on the actually-downloaded
 * bytes, since a client-declared size is not trustworthy either.
 */
export const CreateFileSourceSchema = z.object({
  notebookId: z.uuid("Ungültige Notizbuch-ID"),
  title: z
    .string()
    .min(1, "Titel ist erforderlich")
    .max(500, "Titel darf höchstens 500 Zeichen lang sein"),
  fileName: z.string().min(1, "Dateiname ist erforderlich"),
  fileSizeBytes: z
    .number()
    .int()
    .positive("Datei ist leer")
    .max(MAX_UPLOAD_BYTES, "Datei überschreitet das erlaubte Limit"),
  // Advisory only — the browser's reported content type. Accepted as a free
  // string (some platforms report "" for .txt/.md/.csv) and validated for
  // real by `detectFileFormat` together with the file name, then re-checked
  // against the actual bytes' magic number in the worker.
  fileMimeType: z.string(),
  // Client-computed SHA-256 (hex) of the file's bytes — only weakly
  // trustworthy on its own (the client uploads straight to Storage, the
  // server never sees the bytes before the worker downloads them), so the
  // worker re-hashes and its value always wins on a mismatch
  // (`service.ts`'s `reconcileContentHash`). Still validated here as a
  // well-formed hex digest so a malformed value can't reach the dedupe
  // query/insert at all.
  contentHash: z.string().regex(/^[0-9a-f]{64}$/, "Ungültiger Datei-Hash"),
})

export const ProcessSourceSchema = z.object({
  sourceId: z.uuid("Ungültige Quellen-ID"),
})

export const AddTextSourceSchema = z.object({
  notebookId: z.uuid("Ungültige Notizbuch-ID"),
  title: z
    .string()
    .min(1, "Titel ist erforderlich")
    .max(500, "Titel darf höchstens 500 Zeichen lang sein"),
  text: z
    .string()
    .min(1, "Text ist erforderlich")
    .max(500_000, "Text darf höchstens 500.000 Zeichen lang sein"),
})

/**
 * `z.url()` alone accepts any URL scheme (including `ftp:`/`file:`), so a
 * scheme allowlist is layered on via `.refine` — AC-7 requires syntactically
 * invalid URLs AND non-http(s) schemes to be rejected inline. This is a
 * *cheap* syntactic pre-check only; the real SSRF defense is
 * `assertSafeUrl`/`fetchWebPage` in `extract.ts`, which resolves DNS and
 * checks every redirect hop.
 */
const httpUrlSchema = z
  .url("Gib eine gültige URL ein")
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }, "Nur http(s)-URLs sind erlaubt")

export const AddWebSourceSchema = z.object({
  notebookId: z.uuid("Ungültige Notizbuch-ID"),
  url: httpUrlSchema,
  title: z
    .string()
    .max(500, "Titel darf höchstens 500 Zeichen lang sein")
    .optional(),
})

/** Input for the reader's image-URL lookup — only the source id; the owner
 *  is resolved from the session server-side, never passed in. */
export const SourceImageUrlSchema = z.object({
  sourceId: z.uuid("Ungültige Quellen-ID"),
})

export const RetrySourceSchema = z.object({
  sourceId: z.uuid("Ungültige Quellen-ID"),
})

export const DeleteSourceSchema = z.object({
  sourceId: z.uuid("Ungültige Quellen-ID"),
})

export type CreateFileSourceInput = z.infer<typeof CreateFileSourceSchema>
export type ProcessSourceInput = z.infer<typeof ProcessSourceSchema>
export type AddTextSourceInput = z.infer<typeof AddTextSourceSchema>
export type AddWebSourceInput = z.infer<typeof AddWebSourceSchema>
export type SourceImageUrlInput = z.infer<typeof SourceImageUrlSchema>
export type RetrySourceInput = z.infer<typeof RetrySourceSchema>
export type DeleteSourceInput = z.infer<typeof DeleteSourceSchema>
