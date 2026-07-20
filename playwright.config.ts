import { defineConfig, devices } from "@playwright/test"

import { loadLocalEnv } from "./e2e/support/env"

// Standalone Node execution (not `next dev`) — load `.env.local` ourselves
// so `e2e/support/admin-client.ts` can read the Supabase service-role key.
loadLocalEnv()

// Port 3000 on this machine is occupied by an unrelated project (a
// long-running `next-events/apps/web` dev server) — using it here would make
// `reuseExistingServer` silently attach to the wrong app. This project's own
// dev server runs on 3100 instead, passed through to `next dev` via `pnpm
// dev -- --port 3100` (package.json's `dev` script itself stays untouched).
// `E2E_PORT`-Override: parallele Worktree-Sessions (docs/specs/
// studio-quick-wins.md, Parallelisierungs-Plan) brauchen je einen eigenen
// Dev-Server — sonst attached `reuseExistingServer` an den Server der
// jeweils anderen Session und testet fremden Code.
const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = `http://localhost:${PORT}`

/**
 * E2E config for the local stack (specs/01-notebooks.md §13
 * Test-Infrastruktur): Next dev server on :3100 (see note above), local
 * Supabase on :54521 (see `.env.local`, loaded above). `workers: 1` — the
 * auth fixture creates one shared test user per run (see `auth.setup.ts`),
 * so specs must not run concurrently against it.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalTeardown: "./e2e/support/global-teardown.ts",

  use: {
    baseURL: BASE_URL,
    testIdAttribute: "data-test",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  webServer: {
    // `pnpm dev -- --port N` doesn't work here: pnpm forwards a literal
    // extra `--` into the underlying `next dev` invocation, which then
    // parses `--port` as a positional project-directory argument. Invoking
    // `next` directly via `pnpm exec` sidesteps that.
    command: `pnpm exec next dev --turbopack --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
})
