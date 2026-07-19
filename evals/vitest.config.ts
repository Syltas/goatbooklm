import path from "node:path"

import { defineConfig } from "vitest/config"

/**
 * Eval-only vitest config (specs/03-chat-grounding.md §5, §10 Gruppe H —
 * AC-H2/H3/H4/H5/H6). `evals/*.eval.ts` hit the REAL Claude API
 * (`anthropic('claude-sonnet-5')`) — deliberately NOT part of the normal
 * `pnpm test` run. `vitest.config.ts` (the default config) only picks up
 * `**​/*.test.ts` and additionally excludes `evals/**` for defense in depth,
 * so `pnpm test` never touches this file or makes a network call.
 *
 * Invoke via `pnpm eval`. Needs a real `ANTHROPIC_API_KEY` in `.env.local`
 * (loaded by `guardrail.eval.ts` via `process.loadEnvFile`, same pattern as
 * `e2e/support/env.ts`).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../"),
    },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // "verbose" (not the default reporter) is required for vitest to print
    // the eval script's `console.log` summary (per-case pass/fail + answer
    // excerpts, token usage, cost estimate) to the terminal — the default
    // reporter swallows stdout on a fully-passing run.
    reporters: ["verbose"],
    // Real API calls are slow relative to unit tests; one case, no retries
    // (spec §"Definition of Done": "Jeden Case 1× laufen, kein Retry-Loop").
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 0,
    // Keep requests sequential — five real Claude calls in parallel adds
    // rate-limit risk for no real speed win in an on-demand eval script.
    fileParallelism: false,
  },
})
