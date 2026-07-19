import { createBrowserClient } from "@supabase/ssr"

/**
 * Browser Supabase client for use in Client Components. Safe to call on
 * every render — reuses the anon key, which is public by design.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
