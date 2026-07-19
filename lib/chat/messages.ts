/**
 * Client-safe chat message constants + helpers (Review-Fix L2 — "Server-Prompt
 * im Client-Bundle"). Split out of `lib/chat/prompt.ts` so that Client
 * Components (`components/chat/message-item.tsx`) never import that module
 * directly: `prompt.ts` also holds `GROUNDING_SYSTEM_PROMPT` and the
 * `buildSourceBlock`/`buildUserTurn` composers, which are server-only prompt
 * engineering and have no business shipping in the browser bundle. This
 * module holds ONLY the small set of constants/helpers the UI actually needs
 * to render a message (gate-refusal text, the incomplete-answer hint, and
 * the strip/append pair that keeps the two sides of that hint in lockstep).
 *
 * `lib/chat/prompt.ts` re-exports everything here, so every existing
 * server-side import (`app/api/chat/route.ts`, `lib/chat/service.ts`,
 * `lib/chat/hydrate.ts`) keeps working unchanged via `"./prompt"` — only
 * client-facing call sites need to import from `"./messages"` directly.
 */

/**
 * Schicht 2 Gate-Refusal (specs/03-chat-grounding.md §4 Schicht 2 / §9
 * Fehler-Matrix) — 0 chunks over `p_min_similarity` for the current
 * question. Also the canonical string Schicht 1 rule 3 instructs the model
 * to reproduce verbatim, and the exact string the Badge-Regel
 * (`isRefusal`, `lib/chat/service.ts`) compares against (DE-5/OV11).
 */
export const NO_COVERAGE_MESSAGE = "Ihre Quellen enthalten dazu keine Informationen."

/**
 * Schicht 2 Gate-Refusal for the 0-`ready`-sources case (specs
 * §4 Schicht 2 "2a"): the whole notebook has nothing to ground on, so the
 * request is refused before any embedding/LLM call happens at all.
 */
export const NO_SOURCES_MESSAGE = "Dieses Notebook hat noch keine verarbeiteten Quellen."

/**
 * §9 Fehler-Matrix "Stream-Abbruch nach Teil-Tokens": when `finishReason !==
 * "stop"`, the route appends this hint to the (validated) partial content
 * before persisting (AC-I3 — "Teiltext ... mit Hinweis persistieren, nicht
 * verworfen"). `messages` has no dedicated column for an "incomplete" flag,
 * so the hint text IS the durable signal — `stripIncompleteHint` below is
 * the single place that both appends (route) and detects/strips (client
 * render + reload hydration) it, so the two stay in lockstep.
 */
export const INCOMPLETE_ANSWER_HINT = "Antwort unvollständig — bitte erneut versuchen."

const INCOMPLETE_ANSWER_SUFFIX = `\n\n${INCOMPLETE_ANSWER_HINT}`

/**
 * Detects and strips a trailing `INCOMPLETE_ANSWER_HINT` appended by the
 * route (see above). Used by `components/chat/message-item.tsx` for BOTH a
 * live-streamed message (never has the suffix — the flag instead arrives via
 * the `data-citations` part's `incomplete` boolean, since the hint is only
 * appended after the live text stream has already flushed) and a
 * reload-hydrated message (always carries the suffix if the turn was
 * incomplete, since that's the only durable channel) — one function, one
 * definition of "incomplete", no drift between the two paths.
 */
export function stripIncompleteHint(content: string): {
  content: string
  hadHint: boolean
} {
  if (content.endsWith(INCOMPLETE_ANSWER_SUFFIX)) {
    return { content: content.slice(0, -INCOMPLETE_ANSWER_SUFFIX.length), hadHint: true }
  }
  return { content, hadHint: false }
}

/**
 * Builds the persisted/final content for an incomplete turn (§9,
 * AC-I3) — the single place that appends `INCOMPLETE_ANSWER_HINT`, mirrored
 * by `stripIncompleteHint` above.
 */
export function appendIncompleteHint(cleanedContent: string): string {
  return `${cleanedContent}${INCOMPLETE_ANSWER_SUFFIX}`
}

/**
 * Whether `content` is one of the two deterministic gate-refusal constants
 * (§4 Schicht 2) — neither ever gets the Ungrounded-Badge: `NO_COVERAGE_MESSAGE`
 * is an explicit, correct refusal (DE-5/AC-E4); `NO_SOURCES_MESSAGE` is a
 * system notice, not a model answer, so DE-5's "substanzielle Antwort trotz
 * mitgelieferter Chunks" framing doesn't apply to it either. Shared by the
 * route (`isRefusal` on `data-citations`, Review-Fix M2), `lib/chat/hydrate.ts`
 * (reload path), and `message-item.tsx`'s fallback for messages that
 * (hypothetically) lack the `isRefusal` flag.
 */
export function isGateMessage(content: string): boolean {
  return content === NO_COVERAGE_MESSAGE || content === NO_SOURCES_MESSAGE
}
