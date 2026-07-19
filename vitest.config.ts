import path from "node:path"

import { defineConfig } from "vitest/config"

/**
 * Unit-test config (service-layer only, no jsdom needed — see
 * specs/01-notebooks.md §Test-Infrastruktur). Mirrors the `@/*` path alias
 * from tsconfig.json so test files can import the same way app code does.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // evals/** hits the real Claude API (evals/guardrail.eval.ts) and must
    // stay out of the normal LLM-free `pnpm test` run — see
    // evals/vitest.config.ts (invoked separately via `pnpm eval`). Excluded
    // here too, defense-in-depth, even though the `*.eval.ts` filename
    // already misses the `**/*.test.ts` include pattern.
    exclude: ["node_modules/**", ".next/**", "e2e/**", "evals/**"],
  },
})
