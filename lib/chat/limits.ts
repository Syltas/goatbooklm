/**
 * Output-Token-Budget für Chat-Antworten (Investigate-Fix 2026-07-19).
 *
 * Warum 8192 und nicht 1024 (ursprünglicher Spec-§3.3-Wert): 1024
 * Output-Tokens entsprechen bei deutschem Text mit Markdown und
 * Zitat-Markern nur ~2.000 Zeichen (~2,1 Zeichen/Token, empirisch per
 * Repro verifiziert — `finishReason: "length"`, `outputTokens: 1024`,
 * 2.220 Zeichen). Reale Synthese-Antworten ("fasse beide Briefings
 * zusammen") rissen das Budget mitten im Satz. 8192 deckt lange
 * Briefing-Antworten; `maxDuration = 120` in der Route trägt die
 * Streaming-Dauer.
 *
 * Regression-Guard: `evals/output-budget.eval.ts` (echter Claude-Call,
 * `pnpm eval`) schlägt fehl, wenn dieses Budget wieder so klein wird,
 * dass eine lange Antwort mit `finishReason: "length"` abbricht.
 */
export const CHAT_MAX_OUTPUT_TOKENS = 8192
