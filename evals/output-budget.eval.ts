/**
 * Regression-Eval: Output-Token-Budget (Investigate-Fix 2026-07-19).
 *
 * Bug: `maxOutputTokens: 1024` ließ reale deutsche Synthese-Antworten
 * (~2.000 Zeichen) mit `finishReason: "length"` mitten im Satz abbrechen —
 * der Nutzer sah "Antwort unvollständig — bitte erneut versuchen." bei
 * jeder längeren Frage. Repro: 1024 → finishReason "length",
 * outputTokens exakt 1024, Abbruch mid-Satz.
 *
 * Dieser Eval stellt eine Frage, deren Antwort das alte 1024er-Budget
 * sicher reißt, mit dem PRODUKTIONS-Budget aus `lib/chat/limits.ts` —
 * schlägt fehl (finishReason "length"), falls das Budget je wieder unter
 * die reale Antwortlänge rutscht. Echter Claude-Call, läuft nur via
 * `pnpm eval`, nie in `pnpm test`.
 */
import path from "node:path"

import { describe, expect, it } from "vitest"
import { streamText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"

import { CHAT_MAX_OUTPUT_TOKENS } from "../lib/chat/limits"

// Env — gleiches Muster wie evals/guardrail.eval.ts: echter Anthropic-Call,
// Key kommt aus .env.local (Fallback: bereits gesetzte process.env, z.B. CI).
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"))
} catch {
  // .env.local fehlt oder env schon gesetzt — weiter mit process.env.
}

const CHAT_MODEL_ID = "claude-sonnet-5"

describe("output token budget (regression: finishReason length)", () => {
  it("finishes a long German synthesis answer with finishReason 'stop', not 'length'", async () => {
    const result = streamText({
      model: anthropic(CHAT_MODEL_ID),
      system:
        "You are a helpful assistant. Answer in German with detailed, complete bullet lists. Never cut your answer short.",
      messages: [
        {
          role: "user",
          content:
            "Erkläre ausführlich in mindestens 12 Stichpunkten mit je 2-3 Sätzen, wie man eine Event-Location eröffnet: Genehmigungen, Personal, Ausstattung, Marketing, Pricing, Software, Eröffnungsphase.",
        },
      ],
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    })

    let text = ""
    for await (const delta of result.textStream) text += delta
    const [finishReason, usage] = await Promise.all([result.finishReason, result.usage])

    // Kern-Assertion: die Antwort endet, weil das Modell fertig ist —
    // nicht weil das Budget sie abgeschnitten hat.
    expect(finishReason).toBe("stop")
    // Sanity: es kam eine substanzielle lange Antwort (das alte
    // 1024er-Budget hätte hier bereits abgeschnitten).
    expect(text.length).toBeGreaterThan(2200)
    expect(usage.outputTokens).toBeLessThan(CHAT_MAX_OUTPUT_TOKENS)
  }, 120_000)
})
