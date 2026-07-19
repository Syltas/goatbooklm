import path from "node:path"

/**
 * Playwright config/tests run as plain Node scripts (not through Next.js), so
 * `.env.local` isn't loaded automatically the way `next dev`/`next build` do
 * it. Node 20.6+/22+ ships `process.loadEnvFile`, which is enough here — no
 * `dotenv` devDependency needed. Never hardcode secrets in test files; always
 * read them from `process.env` after this runs.
 */
let loaded = false

export function loadLocalEnv(): void {
  if (loaded) return
  loaded = true

  try {
    process.loadEnvFile(path.resolve(__dirname, "../../.env.local"))
  } catch {
    // Missing file or already-populated env (e.g. CI secrets) — fall back to
    // whatever is already in process.env.
  }
}

export function requireEnv(name: string): string {
  loadLocalEnv()
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required env var "${name}" — check .env.local (local Supabase must be running).`
    )
  }
  return value
}
