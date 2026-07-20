import { randomUUID } from "node:crypto"

import { anthropic } from "@ai-sdk/anthropic"
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai"
import { after } from "next/server"

import {
  appendIncompleteHint,
  buildUserTurn,
  GROUNDING_SYSTEM_PROMPT,
  NO_COVERAGE_MESSAGE,
  NO_SOURCES_MESSAGE,
  splitFollowUpTrailer,
} from "@/lib/chat/prompt"
import { parseCitations } from "@/lib/chat/citations"
import { CHAT_MAX_OUTPUT_TOKENS } from "@/lib/chat/limits"
import { normalizeRefusal } from "@/lib/chat/refusal"
import { chatRequestSchema } from "@/lib/chat/schema"
import { createChatService } from "@/lib/chat/service"
import type {
  ChatCitationsData,
  Citation,
  CitationDetail,
  PromptChunk,
  RetrievedChunk,
} from "@/lib/chat/types"
import { readChunkOffsets } from "@/lib/chat/types"
import { defaultQueryEmbeddingModel, embedQuery } from "@/lib/embeddings/client"
import { createClient } from "@/lib/supabase/server"

/**
 * §3.4 HTTP-Contract. `maxDuration=120` (not 30, Eng-Review F3): Vercel bills
 * wall-clock time including streaming, not just time-to-first-token — 120s
 * is cost-neutral vs. 30s unless actually used, and a long answer near
 * `maxOutputTokens=8192` (or an Anthropic-side retry) could otherwise hit a
 * mid-stream 504. `runtime="nodejs"`: the request-scoped Supabase SSR client
 * + `node:crypto` need Node APIs, not Edge.
 */
export const maxDuration = 120
export const runtime = "nodejs"

/**
 * DoD-Modell-Slug (Eng-Review OV12): verified against the installed
 * `@ai-sdk/anthropic` SDK's own `AnthropicModelId` literal union
 * (`node_modules/@ai-sdk/anthropic/dist/index.d.ts`), which lists
 * `'claude-sonnet-5'` explicitly — a real, currently-deployable slug, not an
 * unverified assumption (Annahme A-5).
 */
const CHAT_MODEL_ID = "claude-sonnet-5"

const TOP_K = 8
const HISTORY_WINDOW = 6
const DEFAULT_MIN_SIMILARITY = 0.35

/**
 * Review-Fix L4 — `CHAT_MIN_SIMILARITY` is an operator-set env var, so it
 * must be parsed defensively rather than trusted: `Number(undefined)` is
 * harmless (`??` already covers "unset"), but `Number("")`/`Number("abc")`
 * is `NaN`, and an out-of-[0,1]-range value (e.g. "2", "-1") is a valid
 * number yet nonsensical as a cosine-similarity cutoff — `match_chunks`
 * would then either reject every chunk or accept everything. Any of those
 * cases silently falls back to `DEFAULT_MIN_SIMILARITY`, never crashes the
 * request or emits a bogus threshold to the retrieval RPC.
 */
function parseMinSimilarity(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MIN_SIMILARITY
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return DEFAULT_MIN_SIMILARITY
  return parsed
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return textError("Ungültiger Request-Body.", 400)
  }

  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return textError(parsed.error.issues[0]?.message ?? "Ungültige Eingabe.", 400)
  }
  const { notebookId, question } = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fail-closed (DoD-Auth): no session, no further work.
  if (!user) {
    return textError("Nicht angemeldet.", 401)
  }

  const service = createChatService({
    db: supabase,
    embed: (text) => embedQuery(defaultQueryEmbeddingModel, text),
    config: {
      topK: TOP_K,
      minSimilarity: parseMinSimilarity(process.env.CHAT_MIN_SIMILARITY),
      historyWindow: HISTORY_WINDOW,
    },
  })

  // §3.2 step 2 — owner check. RLS already scopes `notebooks`, so a foreign
  // or nonexistent id both resolve to `null` here → the same 404 either way
  // (AC-D2, never leaks which case it was).
  const notebook = await service.assertNotebookOwned(notebookId)
  if (!notebook) {
    return textError("Notizbuch nicht gefunden.", 404)
  }

  // §3.2 step 4 (OV4) — history loaded server-side, never from the client
  // body (AC-44).
  const history = await service.loadHistory(notebookId)

  // Gate 2a (§4 Schicht 2) — 0 ready sources ⇒ fail-closed before any
  // embedding/LLM call, atomic turn persistence (DE-7).
  const readyCount = await service.countReadySources(notebookId)
  if (readyCount === 0) {
    // Review-Fix L5 — Antwort > Persistenz: a persist failure here must
    // never prevent the gate refusal from streaming to the user. The turn
    // just won't show up in history on reload; logged, not fatal.
    try {
      await service.persistTurn({
        notebookId,
        userId: user.id,
        question,
        assistantContent: NO_SOURCES_MESSAGE,
        citations: [],
      })
    } catch (err) {
      console.error("[chat] persistTurn failed for NO_SOURCES_MESSAGE gate", err)
    }
    return gateResponse(NO_SOURCES_MESSAGE)
  }

  let queryEmbedding: number[]
  try {
    queryEmbedding = await service.embedQuery(question)
  } catch (err) {
    console.error("[chat] embedQuery failed", err)
    return textError("Embedding-Dienst nicht erreichbar. Bitte erneut versuchen.", 502)
  }

  // Explicit annotation (not just `let chunks`): `buildCitationDetails` below
  // is a hoisted function declaration that closes over `chunks`, which
  // otherwise defeats TS's control-flow-based inference for this `let`
  // (TS7034) since the declaration is reachable before the assignment below
  // from the compiler's static perspective.
  let chunks: RetrievedChunk[]
  try {
    chunks = await service.retrieve(notebookId, queryEmbedding)
  } catch (err) {
    console.error("[chat] retrieve (match_chunks) failed", err)
    return textError("Suche fehlgeschlagen. Bitte erneut versuchen.", 502)
  }

  // Gate 2b (§4 Schicht 2) — 0 chunks over the similarity threshold ⇒ no LLM
  // call, deterministic refusal (AC-H1/AC-B3).
  if (chunks.length === 0) {
    // Review-Fix L5 — same "Antwort > Persistenz" reasoning as the 2a gate
    // above.
    try {
      await service.persistTurn({
        notebookId,
        userId: user.id,
        question,
        assistantContent: NO_COVERAGE_MESSAGE,
        citations: [],
      })
    } catch (err) {
      console.error("[chat] persistTurn failed for NO_COVERAGE_MESSAGE gate", err)
    }
    return gateResponse(NO_COVERAGE_MESSAGE)
  }

  // §3.4 — `match_chunks` doesn't return a title (or type); join both here
  // (composition site responsibility per `PromptChunk`'s docstring,
  // `lib/chat/types.ts`). `type` rides along with the same query so
  // `buildCitationDetails` below can set `CitationDetail.sourceType` (image
  // thumbnail, Design-Review 2026-07-20 §Teil 2) without a second lookup.
  const sourceIds = [...new Set(chunks.map((chunk) => chunk.sourceId))]
  const { data: sourceRows, error: sourceError } = await supabase
    .from("sources")
    .select("id, title, type")
    .in("id", sourceIds)

  if (sourceError) {
    console.error("[chat] source title lookup failed", sourceError)
    return textError("Etwas ist schiefgelaufen. Bitte erneut versuchen.", 500)
  }

  const titleById = new Map((sourceRows ?? []).map((row) => [row.id, row.title]))
  const typeById = new Map((sourceRows ?? []).map((row) => [row.id, row.type]))
  const promptChunks: PromptChunk[] = chunks.map((chunk) => ({
    ...chunk,
    title: titleById.get(chunk.sourceId) ?? "Unbenannte Quelle",
  }))

  const modelMessages = [
    ...history.map((message) => ({ role: message.role, content: message.content })),
    { role: "user" as const, content: buildUserTurn(question, promptChunks) },
  ]

  function mapStreamError(error: unknown): string {
    console.error("[chat] stream error", error)
    return "Modell aktuell nicht verfügbar oder überlastet. Bitte erneut versuchen."
  }

  // Shared by both the normal completion path and the M3 mid-stream-error
  // rescue path below — turns validated `Citation[]` into the UI-facing
  // `CitationDetail[]` shape using the `chunks`/`titleById` already held in
  // memory for this request (no extra DB round trip either way).
  function buildCitationDetails(citations: Citation[]): CitationDetail[] {
    return citations.map((citation) => {
      const chunk = chunks[citation.n - 1]
      const offsets = readChunkOffsets(chunk?.metadata)
      return {
        n: citation.n,
        chunkId: citation.chunk_id,
        sourceId: citation.source_id,
        sourceTitle: titleById.get(citation.source_id) ?? "Unbenannte Quelle",
        sourceType: typeById.get(citation.source_id) ?? "text",
        content: chunk?.content ?? "",
        charStart: offsets.charStart,
        charEnd: offsets.charEnd,
        page: offsets.page,
        // 1-indexed "Absatz N" — see `CitationDetail.paragraph`'s docstring
        // (`lib/chat/types.ts`) for why this is a document-wide ordinal, not
        // a true per-page paragraph count.
        paragraph: typeof chunk?.chunkIndex === "number" ? chunk.chunkIndex + 1 : undefined,
      }
    })
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText({
        model: anthropic(CHAT_MODEL_ID),
        system: GROUNDING_SYSTEM_PROMPT,
        messages: modelMessages,
        temperature: 0.2,
        // 8192, nicht 1024 (Spec §3.3 alt): 1024 Output-Tokens sind bei
        // deutschem Text + Markdown + Zitat-Markern nur ~2.000 Zeichen
        // (~2,1 Zeichen/Token, empirisch verifiziert) — reale Synthese-
        // Antworten ("fasse beide Briefings zusammen") rissen das Budget
        // mid-Satz mit finishReason='length'. 8192 deckt lange Briefings;
        // maxDuration=120 reicht für die Streaming-Dauer.
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      })

      writer.merge(toUIMessageStream({ stream: result.stream, onError: mapStreamError }))

      // F4/AC-43 — drive the model stream to full completion independently
      // of the client connection. `result.stream` tees a fresh branch off
      // the shared internal buffer on every access (see the `ai` package's
      // `teeStream()`), so this doesn't compete with the branch merged
      // above; `.text`/`.finishReason` below transitively force the same
      // full drain regardless of whether anyone reads this branch.
      result.consumeStream()

      // Review-Fix M3 — a THIRD independent tee off the same underlying
      // stream (`result.textStream`), consumed here purely to accumulate
      // whatever text arrives, chunk by chunk, into `partialText`. SDK
      // semantics verified against the installed `ai` package
      // (`node_modules/ai/dist/index.js`, v7.0.31):
      //   - `result.text` (`get text()` → `this.finalStep.then(s => s.text)`,
      //     backed by the `_steps` `DelayedPromise`) REJECTS wholesale on a
      //     mid-stream provider error — `rejectResultPromises()` rejects
      //     `_steps` and everything derived from it, with NO partial value.
      //     That's why the pre-existing `await Promise.all([result.text,
      //     result.finishReason])` below can never recover partial text on
      //     its own.
      //   - The step loop's error handler instead does
      //     `controller.enqueue({ type: "error", error }); self.closeStream()`
      //     — it enqueues an `"error"` part and then closes the stream
      //     NORMALLY (not an abort). `result.textStream` (`get textStream()`
      //     → `toTextStream({ stream: this.stream })`) only forwards
      //     `"text-delta"` parts and silently drops everything else,
      //     including `"error"` — so iterating it via `for await` never
      //     throws; it just stops yielding once the source closes, having
      //     already accumulated every delta that arrived before the failure.
      let partialText = ""
      const collectPartialText = (async () => {
        try {
          for await (const delta of result.textStream) {
            partialText += delta
          }
        } catch {
          // Best-effort accumulation only — whatever made it into
          // `partialText` before this point is still used below.
        }
      })()

      let text: string
      let finishReason: string
      try {
        ;[text, finishReason] = await Promise.all([result.text, result.finishReason])
      } catch (err) {
        // Anthropic failed before/without producing usable output — the
        // merged UI stream already surfaced an `error` chunk via
        // `mapStreamError` above.
        console.error("[chat] streamText failed", err)

        // Review-Fix M3 — rescue whatever partial text streamed before the
        // failure (§9 Fehler-Matrix "Stream-Abbruch nach Teil-Tokens": the
        // partial text must be persisted with a hint, not discarded). Wait
        // for the accumulator above to settle — `result.textStream`'s
        // source stream already closed by the time `result.text` rejected
        // (both are driven by the same underlying step loop), so this
        // resolves immediately in practice; it's here for correctness, not
        // to introduce a real wait.
        await collectPartialText

        if (partialText.trim().length === 0) {
          // Nothing usable was produced at all — unchanged behavior: no
          // persistence (§9: "keine Persistenz").
          return
        }

        // Part B "Folgefragen als Trailer" — strip BEFORE `normalizeRefusal`,
        // not after: `normalizeRefusal`'s short-answer word-overlap check
        // compares `trimmed.length` against `NO_COVERAGE_MESSAGE.length * 2`,
        // and a trailer appended to a genuinely-short quasi-refusal would
        // push it over that threshold, silently breaking that heuristic.
        // `isStreaming: true` — despite this being the final text this
        // request will ever produce, it broke off mid-stream (that's WHY
        // we're in this catch block), so a trailing substring that merely
        // resembles a marker prefix is exactly as likely to be a marker cut
        // off mid-emission as it is to be coincidental prose. `false` here
        // (Review-Fix Befund 1) would persist that partial marker fragment
        // into `messages.content` FOREVER — there is no later render pass
        // that ever re-derives/strips it again once written to the DB.
        const { content: partialWithoutTrailer } = splitFollowUpTrailer(partialText, true)
        const normalizedPartial = normalizeRefusal(partialWithoutTrailer, service)
        const partialValidation = parseCitations(normalizedPartial, chunks)
        if (partialValidation.invalidCount > 0) {
          console.warn(
            `[chat] ${partialValidation.invalidCount} hallucinated citation marker(s) removed from rescued partial text (notebook ${notebookId})`
          )
        }

        const rescuedContent = appendIncompleteHint(partialValidation.cleanedContent)

        writer.write({
          type: "data-citations",
          data: {
            citations: buildCitationDetails(partialValidation.citations),
            incomplete: true,
            isRefusal: partialValidation.cleanedContent === NO_COVERAGE_MESSAGE,
          } satisfies ChatCitationsData,
        })

        after(async () => {
          try {
            await service.persistTurn({
              notebookId,
              userId: user.id,
              question,
              assistantContent: rescuedContent,
              citations: partialValidation.citations,
            })
          } catch (persistErr) {
            console.error(
              "[chat] persistTurn failed in after() (rescued partial text)",
              persistErr
            )
          }
        })
        return
      }

      // Part B "Folgefragen als Trailer" — same "strip before normalizeRefusal"
      // reasoning as the M3 rescue path above. The trailer itself is never
      // persisted or citation-validated; `message-item.tsx` independently
      // re-derives it client-side from the raw streamed text (see
      // `splitFollowUpTrailer`'s docstring) — nothing about it needs to
      // travel through `data-citations`.
      //
      // `isStreaming: finishReason !== "stop"` (Review-Fix Befund 1), not an
      // unconditional `false`: `result.text` resolving without throwing only
      // means the SDK finished driving the request, not that the model's own
      // turn ended cleanly. A `finishReason` of `"length"` (budget hit) or
      // anything else non-"stop" means `text` was cut off at an arbitrary
      // token boundary — possibly mid-marker — same as the M3 rescue case
      // above, and for the same reason must hold back a trailing
      // marker-prefix instead of persisting it as if it were real content.
      const { content: textWithoutTrailer } = splitFollowUpTrailer(
        text,
        finishReason !== "stop"
      )
      const normalizedText = normalizeRefusal(textWithoutTrailer, service)
      const validation = parseCitations(normalizedText, chunks)
      if (validation.invalidCount > 0) {
        console.warn(
          `[chat] ${validation.invalidCount} hallucinated citation marker(s) removed (notebook ${notebookId})`
        )
      }

      const incomplete = finishReason !== "stop"
      const finalContent = incomplete
        ? appendIncompleteHint(validation.cleanedContent)
        : validation.cleanedContent

      writer.write({
        type: "data-citations",
        data: {
          citations: buildCitationDetails(validation.citations),
          incomplete,
          // Review-Fix M2 — decided from the NORMALIZED content, not the raw
          // streamed text (see `ChatCitationsData`'s docstring, `lib/chat/types.ts`,
          // for why the live path can't compare against `content` client-side).
          isRefusal: validation.cleanedContent === NO_COVERAGE_MESSAGE,
        } satisfies ChatCitationsData,
      })

      // §8 — persistence runs in `after()` so it survives a client
      // disconnect (tab close, navigation, Stop-Klick) mid-stream; §9
      // "Client-Abbruch" row.
      after(async () => {
        try {
          await service.persistTurn({
            notebookId,
            userId: user.id,
            question,
            assistantContent: finalContent,
            citations: validation.citations,
          })
        } catch (err) {
          console.error("[chat] persistTurn failed in after()", err)
        }
      })
    },
    onError: mapStreamError,
  })

  return createUIMessageStreamResponse({ stream })
}

function textError(message: string, status: number): Response {
  return new Response(message, { status })
}

/**
 * §3.2 step 8 / §9 — the gate-refusal path uses the SAME UI-message-stream
 * protocol as a real LLM turn (a single text chunk = the gate constant), so
 * `useChat` renders it identically without a special case. No citations, no
 * `[n]` markers, `incomplete: false` (deterministic, never truncated).
 */
function gateResponse(text: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = randomUUID()
      writer.write({ type: "start" })
      writer.write({ type: "start-step" })
      writer.write({ type: "text-start", id })
      writer.write({ type: "text-delta", id, delta: text })
      writer.write({ type: "text-end", id })
      writer.write({ type: "finish-step" })
      writer.write({
        type: "data-citations",
        // Review-Fix M2 — `gateResponse` is only ever called with one of the
        // two deterministic gate constants, so `isRefusal` is unconditionally
        // true here (this text was never touched by the LLM).
        data: { citations: [], incomplete: false, isRefusal: true } satisfies ChatCitationsData,
      })
      writer.write({ type: "finish", finishReason: "stop" })
    },
  })

  return createUIMessageStreamResponse({ stream })
}
