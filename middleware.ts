import { NextResponse, type NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/middleware"

/**
 * Routes reachable without an authenticated session. Everything else falls
 * through to the protected-route check below and redirects to `/login`.
 */
const PUBLIC_PATHS = new Set(["/", "/login", "/signup"])

/**
 * The ingestion worker Route Handler (specs/02-ingestion.md §9) is called
 * exclusively by pg_cron/pg_net — zero cookies, zero Supabase session,
 * ever. It authenticates itself via a constant-time `x-worker-secret`
 * header check inside the route handler. Without this exemption, this
 * middleware's user-session redirect below would 307 every cron tick to
 * `/login` before the route handler's own auth check ever runs, so the
 * worker would never actually process a job.
 */
const WORKER_ROUTE_PATH = "/api/ingestion-worker"

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (pathname === WORKER_ROUTE_PATH) return true
  // Email confirmation / OTP callback routes — hit by an unauthenticated
  // visitor following a link from their inbox.
  if (pathname.startsWith("/auth/")) return true
  return false
}

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = new URL("/login", request.url)
    const redirectResponse = NextResponse.redirect(loginUrl)
    // Carry over any cookies `updateSession` refreshed onto `supabaseResponse`
    // (e.g. a rotated refresh token) — otherwise this redirect response
    // discards them and the browser never sees the refreshed session state.
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie)
    })
    return redirectResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt
     * - common static asset extensions
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
