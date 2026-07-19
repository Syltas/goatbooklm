import { z } from "zod"

/**
 * Zod schema for `POST /api/chat`'s request body (specs/03-chat-grounding.md
 * §3.4). Eng-Review 2026-07-19, OV4: deliberately just `{ notebookId,
 * question }` — NOT a client-supplied `messages` array. A forged
 * `messages` array could smuggle fake assistant turns past Schicht-1's
 * system-prompt trust in the prior dialogue, and would have unbounded input
 * tokens. History is loaded server-side instead (`ChatService.loadHistory`,
 * `lib/chat/service.ts`) from the RLS-scoped `messages` table, never from
 * client input — see AC-44.
 *
 * `question` is trimmed before the length checks run: `.trim()` normalizes
 * the value first, so a whitespace-only input correctly fails `.min(1)`
 * rather than passing through as a non-empty but blank string.
 */
export const chatRequestSchema = z.object({
  notebookId: z.uuid("Ungültige Notizbuch-ID"),
  question: z
    .string()
    .trim()
    .min(1, "Frage ist erforderlich")
    .max(4000, "Frage darf höchstens 4000 Zeichen lang sein"),
})

export type ChatRequestInput = z.infer<typeof chatRequestSchema>
