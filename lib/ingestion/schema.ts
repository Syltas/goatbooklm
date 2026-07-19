import { z } from "zod"

/**
 * Zod schemas for the ingestion feature (specs/02-ingestion.md §9). These
 * validate Server Action input at the adapter layer (`enhanceAction({
 * schema })`) — the service layer itself does not re-validate, matching the
 * convention in `lib/notebooks/service.ts`.
 */

export const CreatePdfSourceSchema = z.object({
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
    .max(20_971_520, "Datei darf höchstens 20MB groß sein"),
  fileMimeType: z.literal("application/pdf", {
    error: "Nur PDF-Dateien sind erlaubt",
  }),
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

export const RetrySourceSchema = z.object({
  sourceId: z.uuid("Ungültige Quellen-ID"),
})

export const DeleteSourceSchema = z.object({
  sourceId: z.uuid("Ungültige Quellen-ID"),
})

export type CreatePdfSourceInput = z.infer<typeof CreatePdfSourceSchema>
export type ProcessSourceInput = z.infer<typeof ProcessSourceSchema>
export type AddTextSourceInput = z.infer<typeof AddTextSourceSchema>
export type AddWebSourceInput = z.infer<typeof AddWebSourceSchema>
export type RetrySourceInput = z.infer<typeof RetrySourceSchema>
export type DeleteSourceInput = z.infer<typeof DeleteSourceSchema>
