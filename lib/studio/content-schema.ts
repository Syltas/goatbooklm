import { z } from "zod"

/**
 * Content-Schemas der strukturierten Studio-Artefakte (client-safe — die
 * Viewer parsen das `content`-jsonb damit defensiv, die Route nutzt sie
 * als `generateObject`-Schema). Reports bleiben Freitext-Markdown und
 * haben bewusst KEIN Schema hier.
 */

export const flashcardsContentSchema = z.object({
  /** Deck-Titel im Stil „Relativitäts-Karteikarten" — wird `title` der Row. */
  title: z.string().min(1),
  cards: z
    .array(
      z.object({
        /** Vorderseite: Frage oder Begriff. */
        front: z.string().min(1),
        /** Rückseite: prägnante Antwort (1-3 Sätze). */
        back: z.string().min(1),
      })
    )
    .min(4),
})

export type FlashcardsContent = z.infer<typeof flashcardsContentSchema>

export const quizContentSchema = z.object({
  /** Quiz-Titel im Stil „Relativitäts-Quiz" — wird `title` der Row. */
  title: z.string().min(1),
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        /** Denkanstoß OHNE die Antwort zu verraten (Hint-Toggle). */
        hint: z.string().min(1),
        options: z
          .array(
            z.object({
              text: z.string().min(1),
              /** Warum diese Option richtig bzw. falsch ist — wird nach der
               *  Antwort unter JEDER Option angezeigt (NotebookLM-Parität). */
              explanation: z.string().min(1),
            })
          )
          .length(4),
        correct_index: z.number().int().min(0).max(3),
      })
    )
    .min(4)
    .max(12),
})

export type QuizContent = z.infer<typeof quizContentSchema>

/** Defensives Parsen des `content`-jsonb einer Row — `null` statt Crash bei
 *  altem/kaputtem Shape (Viewer zeigen dann einen Fehlerzustand). */
export function parseFlashcardsContent(content: unknown): FlashcardsContent | null {
  const parsed = flashcardsContentSchema.safeParse(content)
  return parsed.success ? parsed.data : null
}

export function parseQuizContent(content: unknown): QuizContent | null {
  const parsed = quizContentSchema.safeParse(content)
  return parsed.success ? parsed.data : null
}
