import { z } from "zod"

/**
 * Report-Formate (docs/specs/studio-quick-wins.md): exakt 3 feste Formate,
 * keine Suggestions, kein "Create Your Own". Die Zod-Enum ist die eine
 * Quelle der Wahrheit — DB-Check-Constraint, Prompt-Registry und UI-Karten
 * hängen alle an diesem Tripel.
 */
export const REPORT_FORMAT_VALUES = [
  "briefing_doc",
  "study_guide",
  "blog_post",
] as const

export type ReportFormat = (typeof REPORT_FORMAT_VALUES)[number]

/**
 * `POST /api/studio/generate` — discriminated union (Spec "Generierung"):
 * Neu-Generierung trägt `format` (+ optionales, in v1 ignoriertes
 * `sourceIds` als Forward-Compat für die Quellen-Auswahl nach dem
 * core-loop-v2-Merge); Retry trägt NUR `retryArtifactId` — `format` kommt
 * dann aus der persistierten Row, ein Body-`format` ist absichtlich nicht
 * erlaubt (Review-Fix R2-2: kein "wer gewinnt?"-Konflikt).
 */
export const generateReportSchema = z.union([
  z.object({
    notebookId: z.uuid("Ungültige Notizbuch-ID"),
    format: z.enum(REPORT_FORMAT_VALUES),
    sourceIds: z.array(z.uuid()).optional(),
  }),
  z.object({
    notebookId: z.uuid("Ungültige Notizbuch-ID"),
    retryArtifactId: z.uuid("Ungültige Artefakt-ID"),
  }),
])

export type GenerateReportInput = z.infer<typeof generateReportSchema>

export const RenameStudioArtifactSchema = z.object({
  artifactId: z.uuid("Ungültige Artefakt-ID"),
  title: z
    .string()
    .trim()
    .min(1, "Titel ist erforderlich")
    .max(255, "Titel darf höchstens 255 Zeichen lang sein"),
})

export const DeleteStudioArtifactSchema = z.object({
  artifactId: z.uuid("Ungültige Artefakt-ID"),
})
