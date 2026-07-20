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

/**
 * Part B "Folgefragen als Trailer" (not `Output.object` — see
 * `app/api/chat/route.ts`'s comment on why: forcing a JSON-shaped structured
 * response would show the user a live-typed `{"answer":"…` and, for a model
 * that isn't natively `json_schema`-qualified, makes `@ai-sdk/anthropic` fall
 * back to a forced tool call — whose content arrives as a tool-input delta,
 * not a text delta, which kills streaming entirely; verified against the
 * installed SDK, not assumed). The model instead appends this literal marker
 * line at the very end of a normal answer, followed by three numbered
 * follow-up questions — a plain suffix on the same text stream, so every
 * existing text-delta mechanism (`toUIMessageStream`, the M3 partial-text
 * rescue, `parseCitations`, `appendIncompleteHint`) keeps working unchanged;
 * only one new strip step has to run before them.
 *
 * `<<<…>>>` over a Markdown-ish delimiter (`#`, `-`, `>`, backticks) or a
 * JSON-looking one: none of those ever legitimately appear in a real
 * Markdown answer, `<<<FOLGEFRAGEN>>>` is ASCII-art-like and reads
 * unambiguously as "not prose" even in a raw log line, and — unlike a plain
 * word or a single symbol — its 3-character run of `<`/`>` is not a
 * character sequence ordinary German answer text or a quoted source excerpt
 * would ever produce by coincidence.
 */
export const FOLLOW_UP_TRAILER_MARKER = "<<<FOLGEFRAGEN>>>"

/** How many of `text`'s trailing characters equal a PREFIX of `marker` —
 *  e.g. if `text` ends in `"…<<<FOLG"` and `marker` is
 *  `"<<<FOLGEFRAGEN>>>"`, this returns 8 (the length of `"<<<FOLG"`). Used
 *  by `splitFollowUpTrailer` below to hold back an in-progress marker from
 *  live-streamed text before it's known whether the rest of the marker is
 *  actually coming. */
function longestSuffixPrefixOverlap(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1)
  for (let length = max; length > 0; length--) {
    if (text.endsWith(marker.slice(0, length))) return length
  }
  return 0
}

/**
 * Splits a raw model text into the answer `content` and the (unparsed)
 * `trailer` block after `FOLLOW_UP_TRAILER_MARKER`, if present. Used by BOTH
 * `app/api/chat/route.ts` (on the final/rescued accumulated text, BEFORE
 * `normalizeRefusal`/`parseCitations`/persistence — a trailer left in would
 * both pollute the persisted history the next turn reads back and, via its
 * added length, break `normalizeRefusal`'s short-answer word-overlap
 * heuristic) and `message-item.tsx` (on the live-streaming `rawText`, every
 * render) — one function, so the two can never disagree on what counts as
 * "the marker" (mirrors this file's `stripIncompleteHint`/
 * `appendIncompleteHint` pairing above).
 *
 * `isStreaming` gates the only behavioral difference between the two
 * callers. While the message is still arriving, a trailing substring that
 * merely *could* be the start of the marker (e.g. "…\n\n<<<FOLG" so far) is
 * held back out of `content` too — otherwise the in-progress marker would
 * flash as raw text for the tokens between it starting and completing (DoD:
 * "blitzt während des Streamens nicht als Rohtext auf"). Once streaming has
 * finished (`isStreaming: false` — every server-side call, and every
 * reload-hydrated message), that hold-back is skipped: a trailing substring
 * that merely resembles a marker prefix in a FINISHED message is real
 * content (e.g. an answer that legitimately ends in "< 100"), not a
 * truncated marker, and must render in full rather than losing characters.
 */
export function splitFollowUpTrailer(
  rawText: string,
  isStreaming: boolean
): { content: string; trailer: string | null } {
  const markerIndex = rawText.indexOf(FOLLOW_UP_TRAILER_MARKER)
  if (markerIndex !== -1) {
    return {
      content: rawText.slice(0, markerIndex).trimEnd(),
      trailer: rawText.slice(markerIndex + FOLLOW_UP_TRAILER_MARKER.length),
    }
  }

  if (!isStreaming) return { content: rawText, trailer: null }

  const overlap = longestSuffixPrefixOverlap(rawText, FOLLOW_UP_TRAILER_MARKER)
  return {
    content: overlap > 0 ? rawText.slice(0, rawText.length - overlap) : rawText,
    trailer: null,
  }
}

// "Sinnvolle Länge" (Bugfix Befund 2): short enough to read as a chip, long
// enough that a bare token ("Ja.", "Mehr?") can't pass. Upper bound guards
// against the model running on past a single follow-up line without a
// break — a 200-char "question" is almost certainly two sentences that
// slipped past the line-split, not one clickable chip.
const MIN_FOLLOW_UP_QUESTION_LENGTH = 8
const MAX_FOLLOW_UP_QUESTION_LENGTH = 200

/**
 * Whether `line` (already trimmed, numbering-prefix already stripped) is
 * plausible as a real follow-up prompt rather than one of the two ways a
 * trailer line can be garbage (Bugfix Befund 2):
 *
 * 1. An intro/label line the model prepended despite rule 9's instructions
 *    ("Hier sind drei Folgefragen:") — these are themselves grammatically
 *    fine German sentences, so length/word-count alone can't reject them.
 *    What they reliably have that a real question/instruction never does is
 *    a trailing ":" — they're introducing the list below, not asking
 *    anything. Requiring the line to end in "?"/"."/"!" instead (a question
 *    OR an imperative instruction — rule 9 asks for questions specifically,
 *    but the model occasionally phrases one as "Fasse X zusammen." instead,
 *    and that's still a perfectly clickable follow-up) rejects the label
 *    line without rejecting that phrasing.
 * 2. A stray single-word fragment (a mis-split line, a lone "Ja." from some
 *    other part of the model's output) — `\s` requires at least two words.
 */
function looksLikeFollowUpQuestion(line: string): boolean {
  if (
    line.length < MIN_FOLLOW_UP_QUESTION_LENGTH ||
    line.length > MAX_FOLLOW_UP_QUESTION_LENGTH
  ) {
    return false
  }
  if (!/[?.!]$/.test(line)) return false
  if (!/\s/.test(line)) return false
  return true
}

/**
 * Parses an already-split-off trailer body into up to 3 follow-up question
 * strings. Tolerant of the model's exact numbering style ("1. ", "1) ", or
 * none) and of blank lines — this is generated prose, not a machine-emitted
 * format.
 *
 * Every candidate line is run through `looksLikeFollowUpQuestion` (Bugfix
 * Befund 2 — previously ANY non-empty line passed, so an intro line the
 * model prepended ("Hier sind drei Folgefragen:") became chip #1, and
 * `chat-panel.tsx`'s `handleAskFollowUp` fires a clicked chip at the API
 * immediately, with no chance to edit — the user would be sending that
 * intro line as a question) and deduplicated case-insensitively (a repeated
 * line would otherwise also produce a duplicate React `key` in
 * `message-item.tsx`). A trailer that doesn't parse into anything usable
 * returns `[]` rather than throwing: per the DoD, "Lässt er sich nicht
 * parsen, wird die Antwort normal gerendert und es erscheinen einfach keine
 * Chips" — a malformed trailer must never break the message it's attached
 * to, and an empty result is the documented fallback, not a special case.
 */
export function parseFollowUpQuestions(trailer: string): string[] {
  const seen = new Set<string>()
  const questions: string[] = []

  for (const rawLine of trailer.split("\n")) {
    if (questions.length === 3) break

    const line = rawLine.trim().replace(/^\d+[.)]\s*/, "")
    if (!looksLikeFollowUpQuestion(line)) continue

    const dedupeKey = line.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    questions.push(line)
  }

  return questions
}
