import { z } from "zod"

import {
  AUDIO_FORMAT_VALUES,
  AUDIO_LANGUAGE_CODES,
  AUDIO_LENGTH_VALUES,
} from "./audio-schema"

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

/** Generierbare Artefakt-Typen. Audio läuft asynchron über die pgmq-Queue
 *  (docs/specs/studio-audio.md), die anderen inline über dieselbe Route. */
export const GENERATABLE_TYPE_VALUES = ["report", "flashcards", "quiz", "audio"] as const

export type GeneratableType = (typeof GENERATABLE_TYPE_VALUES)[number]

/**
 * `POST /api/studio/generate` — discriminated union (Spec "Generierung"):
 * Neu-Generierung trägt `type` (+ `format` NUR bei Reports) und die im
 * Create-Dialog gewählten `sourceIds` (leer/fehlend = alle ready-Quellen);
 * Retry trägt NUR `retryArtifactId` — type/format kommen dann aus der
 * persistierten Row, ein Body-`format` ist absichtlich nicht erlaubt
 * (Review-Fix R2-2: kein "wer gewinnt?"-Konflikt).
 */
export const generateArtifactSchema = z.union([
  z.object({
    notebookId: z.uuid("Ungültige Notizbuch-ID"),
    type: z.literal("report"),
    format: z.enum(REPORT_FORMAT_VALUES),
    sourceIds: z.array(z.uuid()).optional(),
  }),
  z.object({
    notebookId: z.uuid("Ungültige Notizbuch-ID"),
    type: z.enum(["flashcards", "quiz"]),
    sourceIds: z.array(z.uuid()).optional(),
  }),
  z.object({
    notebookId: z.uuid("Ungültige Notizbuch-ID"),
    type: z.literal("audio"),
    format: z.enum(AUDIO_FORMAT_VALUES),
    language: z.enum(AUDIO_LANGUAGE_CODES),
    length: z.enum(AUDIO_LENGTH_VALUES),
    focus: z.string().trim().max(500, "Fokus darf höchstens 500 Zeichen lang sein").optional(),
    sourceIds: z.array(z.uuid()).optional(),
  }),
  z.object({
    notebookId: z.uuid("Ungültige Notizbuch-ID"),
    retryArtifactId: z.uuid("Ungültige Artefakt-ID"),
  }),
])

export type GenerateArtifactInput = z.infer<typeof generateArtifactSchema>

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
