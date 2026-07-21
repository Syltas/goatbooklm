import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/database.types"

/**
 * Server-side rate limiting for the paid-AI endpoints. The counter lives in
 * Postgres (`public.rate_limits` + `public.check_rate_limit`), not in memory:
 * Vercel serverless spreads one user's burst across many instances, so an
 * in-process limiter would never see the full request rate. See the migration
 * `20260721120000_create_rate_limits.sql` for the atomicity guarantees.
 */

/** The buckets the `check_rate_limit` RPC counts against, one per cost surface. */
export type RateLimitBucket = "chat" | "studio_generate" | "studio_audio"

export interface RateLimitPolicy {
  /** Max allowed requests within `windowSeconds` (inclusive). */
  limit: number
  /** Fixed-window length in seconds. */
  windowSeconds: number
}

/**
 * Tunable per-bucket limits — the single source of truth (the migration is
 * deliberately limit-agnostic). Chosen deliberately, not magic literals:
 *
 * - `chat`: 30 / 60s — an interactive Q&A pace no human sustains, but a scripted
 *   loop hits it in ~2s. One Anthropic completion per request.
 * - `studio_generate`: 10 / 60s — report/flashcards/quiz each run one Anthropic
 *   generation; 10/min still allows rapid legit creation while capping a loop.
 * - `studio_audio`: 5 / 3600s — ADDITIONAL, tighter gate on `type === 'audio'`
 *   only: audio also drives ElevenLabs per-character TTS (the most expensive
 *   surface), so it's throttled hard by the hour on top of `studio_generate`.
 */
export const RATE_LIMITS = {
  chat: { limit: 30, windowSeconds: 60 },
  studio_generate: { limit: 10, windowSeconds: 60 },
  studio_audio: { limit: 5, windowSeconds: 3600 },
} as const satisfies Record<RateLimitBucket, RateLimitPolicy>

export interface RateLimitResult {
  /** false ⇒ the caller must stop and return 429 before any paid work. */
  allowed: boolean
  bucket: RateLimitBucket
  limit: number
  windowSeconds: number
}

/**
 * Atomically increment-and-check the caller's counter for `bucket`. The RPC
 * resolves the user server-side via `auth.uid()`; we never pass a user id.
 *
 * FAIL-OPEN: if the RPC itself errors (limiter/plumbing bug, transient DB
 * blip), we log and ALLOW. The routes have already resolved and authenticated
 * the user before calling this — a limiter fault must not hard-block real,
 * paying users. The trade-off is that a DB outage temporarily removes the cap;
 * that's an accepted, logged degradation, not the steady state.
 *
 * @param supabase A request-scoped server client (carries the user's JWT so
 *   `auth.uid()` resolves inside the security-definer function).
 */
export async function enforceRateLimit(
  supabase: SupabaseClient<Database>,
  bucket: RateLimitBucket,
  policy: RateLimitPolicy
): Promise<RateLimitResult> {
  const base = { bucket, limit: policy.limit, windowSeconds: policy.windowSeconds }

  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_limit: policy.limit,
    p_window_seconds: policy.windowSeconds,
  })

  if (error) {
    console.error(
      `[ratelimit] check_rate_limit RPC failed for bucket "${bucket}" — allowing request (fail-open)`,
      error
    )
    return { allowed: true, ...base }
  }

  // The RPC returns a plain boolean; anything other than an explicit `true`
  // (e.g. an unexpected null) is treated as "not allowed" to stay fail-safe on
  // a well-formed but surprising response.
  return { allowed: data === true, ...base }
}
