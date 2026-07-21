import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/database.types"

import { enforceRateLimit, RATE_LIMITS, type RateLimitPolicy } from "../index"

const POLICY: RateLimitPolicy = { limit: 30, windowSeconds: 60 }

/** Minimal stand-in for the Supabase client — only `.rpc()` is exercised. */
function createRpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result))
  const client = { rpc } as unknown as SupabaseClient<Database>
  return { client, rpc }
}

describe("enforceRateLimit", () => {
  it("calls check_rate_limit with the p_-prefixed bucket/limit/window args", async () => {
    const { client, rpc } = createRpcClient({ data: true, error: null })

    await enforceRateLimit(client, "chat", POLICY)

    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_bucket: "chat",
      p_limit: 30,
      p_window_seconds: 60,
    })
  })

  it("allows when the RPC returns true, echoing the policy back", async () => {
    const { client } = createRpcClient({ data: true, error: null })

    await expect(enforceRateLimit(client, "studio_generate", POLICY)).resolves.toEqual({
      allowed: true,
      bucket: "studio_generate",
      limit: 30,
      windowSeconds: 60,
    })
  })

  it("blocks when the RPC returns false", async () => {
    const { client } = createRpcClient({ data: false, error: null })

    const result = await enforceRateLimit(client, "studio_audio", POLICY)

    expect(result.allowed).toBe(false)
  })

  it("treats a surprising non-true value (e.g. null) as NOT allowed (fail-safe)", async () => {
    const { client } = createRpcClient({ data: null, error: null })

    const result = await enforceRateLimit(client, "chat", POLICY)

    expect(result.allowed).toBe(false)
  })

  it("FAILS OPEN: allows and logs when the RPC itself errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = createRpcClient({ data: null, error: { message: "boom" } })

    const result = await enforceRateLimit(client, "chat", POLICY)

    expect(result.allowed).toBe(true)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("exposes tunable per-bucket limits (not magic literals in the routes)", () => {
    expect(RATE_LIMITS.chat).toEqual({ limit: 30, windowSeconds: 60 })
    expect(RATE_LIMITS.studio_generate).toEqual({ limit: 10, windowSeconds: 60 })
    expect(RATE_LIMITS.studio_audio).toEqual({ limit: 5, windowSeconds: 3600 })
  })
})
