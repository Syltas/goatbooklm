import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { requireEnv } from "./env"

/**
 * Service-role Supabase client for test setup/teardown only.
 *
 * This intentionally does NOT import `@/lib/supabase/admin` — that module
 * starts with `import "server-only"`, and the `server-only` package's
 * `package.json` "exports" map only resolves to its no-op build under the
 * `react-server` condition (set by Next.js's RSC bundler). Under plain Node
 * module resolution (which is what Playwright's test runner uses), it
 * resolves to `index.js`, which unconditionally throws on import. So a
 * standalone admin client is created here instead — same credentials
 * (service role, from `.env.local`), no app-code changes required.
 */
export function createTestAdminClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
