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

  // Per-TEST timeout — distinct from `webServer.timeout` below, which only
  // bounds how long Playwright waits for the dev server to come up once, at
  // the start of the whole run. Playwright's own default here is 30s, far
  // too short: `e2e/sources/sources.spec.ts` calls
  // `sources.waitForReady(90_000)` (real queue + worker + a real OpenAI
  // embedding call) but never raises its own `test.setTimeout`, so the
  // surrounding 30s default kills the test before that 90s budget can ever
  // be spent — it currently only finishes in ~20s and stays green, which is
  // exactly why this was a *latent* flake risk (an ingestion run running
  // anywhere near its 90s ceiling would die from the outer test timeout,
  // not from `waitForReady`'s own), not a currently-failing test.
  // 120s = the 90s ingestion budget plus ~30s slack for the notebook
  // create/open, form fill, reader open/close, delete-confirm, and cleanup
  // steps either side of it — generous enough that a slow tick under load
  // doesn't turn into a false failure. `e2e/chat/*.spec.ts` layer the same
  // ingestion wait UNDER two real Claude calls, so they already raise their
  // own budget further via `test.setTimeout(240_000)`; this is only the
  // floor every other spec (this one included) needs.
  timeout: 120_000,

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
