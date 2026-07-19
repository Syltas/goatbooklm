import type { User } from "@supabase/supabase-js"
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Session-refresh helper for the root `middleware.ts` (built separately).
 * Standard pattern from the `@supabase/ssr` docs: reads the auth cookie,
 * refreshes the session if needed, and writes the refreshed cookies onto
 * both the incoming request and the outgoing response so Server Components
 * downstream see an up-to-date session.
 *
 * Returns both the refreshed response and the resolved `user` so the root
 * middleware can decide whether to redirect — route-based redirects are
 * intentionally NOT done in here (see note below).
 *
 * Usage in `middleware.ts`:
 *
 * ```ts
 * import { updateSession } from "@/lib/supabase/middleware"
 *
 * export async function middleware(request: NextRequest) {
 *   const { supabaseResponse, user } = await updateSession(request)
 *   if (!user && isProtected(request.nextUrl.pathname)) {
 *     return NextResponse.redirect(new URL("/login", request.url))
 *   }
 *   return supabaseResponse
 * }
 * ```
 */
export async function updateSession(
  request: NextRequest
): Promise<{ supabaseResponse: NextResponse; user: User | null }> {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not run code between `createServerClient` and
  // `supabase.auth.getUser()`. A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.

  // IMPORTANT: `getUser()` sends a request to the Supabase Auth server on
  // every call, which is what actually refreshes the session. Do not
  // replace this with `getSession()` inside middleware.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // IMPORTANT: Route-based redirects (e.g. bouncing unauthenticated users
  // to `/login`) belong in the root `middleware.ts` that calls this helper,
  // not here — this helper only refreshes the session and hands back the
  // resolved `user` for the caller to decide.

  // IMPORTANT: You *must* return the `supabaseResponse` object as is (or a
  // response derived from it) to the client. If you're creating a new
  // response object, make sure to:
  // 1. Pass the request in it: `NextResponse.next({ request })`
  // 2. Copy over the cookies: `newResponse.cookies.setAll(supabaseResponse.cookies.getAll())`
  // 3. Change the newResponse object (not the response object) as needed
  // Otherwise the browser and server may get out of sync and terminate the
  // user's session prematurely.

  return { supabaseResponse, user }
}
