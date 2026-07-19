import "server-only"

import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * Service-role Supabase client. Bypasses Row Level Security entirely — use
 * sparingly, only for trusted server-side operations (webhooks, cron jobs,
 * admin tooling) that cannot run under the caller's RLS policies, and always
 * validate ownership manually before mutating data. Never import this into
 * client-facing code paths; `import "server-only"` above enforces that at
 * build time.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
