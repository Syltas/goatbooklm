import type { EmailOtpType } from "@supabase/supabase-js"
import { redirect } from "next/navigation"
import { type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"

/**
 * Only allow redirecting back to a same-site path. `next` comes from an
 * unauthenticated, attacker-controllable query string, so a bare
 * `redirect(next)` would be an open-redirect vector. This must reject not
 * just `next=https://evil.example` and the protocol-relative
 * `next=//evil.example`, but also browser-normalized variants:
 * `next=/\evil.example` (browsers treat a leading `\` like `/`, so this
 * becomes protocol-relative once followed) and whitespace/control-char
 * tricks like `next=/%09/evil.example` (a stripped tab collapses it to
 * `//evil.example`).
 */
function safeNextPath(next: string | null) {
  if (
    !next ||
    !/^\/[^/\\]/.test(next) ||
    /[\s\x00-\x1f]/.test(next)
  ) {
    return "/notebooks"
  }
  return next
}

/**
 * Target of the confirmation / magic-link URL Supabase Auth emails to an
 * unauthenticated visitor (signup confirmation, email change, magic link).
 * Public by design — there is no session yet when this is hit; verifying
 * the `token_hash` is what creates one.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = safeNextPath(searchParams.get("next"))

  if (tokenHash && type) {
    const supabase = await createClient()

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })

    if (!error) {
      redirect(next)
    }
  }

  redirect("/login")
}
