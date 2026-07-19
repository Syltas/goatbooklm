import { describe, expect, it } from "vitest"

import { INGESTION_MESSAGES } from "../messages"
import {
  effectiveErrorMessage,
  effectiveStatus,
  isNonFinal,
  isStalePending,
  isStaleProcessing,
  type StatusLike,
} from "../source-status"

function processingSince(msAgo: number, overrides: Partial<StatusLike> = {}): StatusLike {
  return {
    status: "processing",
    updated_at: new Date(Date.now() - msAgo).toISOString(),
    error_message: null,
    ...overrides,
  }
}

describe("source-status stale-guard (AC-46)", () => {
  it("a fresh processing source is not stale", () => {
    const source = processingSince(30_000) // 30s ago
    expect(isStaleProcessing(source)).toBe(false)
    expect(effectiveStatus(source)).toBe("processing")
    expect(effectiveErrorMessage(source)).toBeNull()
    expect(isNonFinal(source)).toBe(true)
  })

  it("a processing source older than 10 minutes is treated as error", () => {
    const source = processingSince(11 * 60 * 1000)
    expect(isStaleProcessing(source)).toBe(true)
    expect(effectiveStatus(source)).toBe("error")
    expect(effectiveErrorMessage(source)).toBe(INGESTION_MESSAGES.staleTimeout)
    expect(isNonFinal(source)).toBe(false)
  })

  it("a real error source is unaffected by the staleness check", () => {
    const source: StatusLike = {
      status: "error",
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      error_message: "PDF konnte nicht gelesen werden.",
    }
    expect(isStaleProcessing(source)).toBe(false)
    expect(effectiveStatus(source)).toBe("error")
    expect(effectiveErrorMessage(source)).toBe("PDF konnte nicht gelesen werden.")
    expect(isNonFinal(source)).toBe(false)
  })

  it("a ready source is never considered stale regardless of age", () => {
    const ready: StatusLike = {
      status: "ready",
      updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      error_message: null,
    }
    expect(isStaleProcessing(ready)).toBe(false)
    expect(isStalePending(ready)).toBe(false)
    expect(isNonFinal(ready)).toBe(false)
  })

  it("a fresh pending source is not stale (AC-31 poll keeps running)", () => {
    const pending: StatusLike = {
      status: "pending",
      updated_at: new Date(Date.now() - 30_000).toISOString(),
      error_message: null,
    }
    expect(isStalePending(pending)).toBe(false)
    expect(effectiveStatus(pending)).toBe("pending")
    expect(isNonFinal(pending)).toBe(true)
  })

  // Eng-Review M2: a pending source stuck for >10min (the enqueue/pickup
  // never happened, or got lost) is now treated the same way a stale
  // `processing` row is — rendered as `error` with its own fixed message,
  // and no longer keeps the poll loop alive.
  it("a pending source older than 10 minutes is treated as error (M2)", () => {
    const pending: StatusLike = {
      status: "pending",
      updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      error_message: null,
    }
    expect(isStalePending(pending)).toBe(true)
    expect(isStaleProcessing(pending)).toBe(false)
    expect(effectiveStatus(pending)).toBe("error")
    expect(effectiveErrorMessage(pending)).toBe(INGESTION_MESSAGES.stalePending)
    expect(isNonFinal(pending)).toBe(false)
  })

  it("stale-pending and stale-processing produce distinct messages", () => {
    const stalePending: StatusLike = {
      status: "pending",
      updated_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      error_message: null,
    }
    const staleProcessing: StatusLike = {
      status: "processing",
      updated_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      error_message: null,
    }
    expect(effectiveErrorMessage(stalePending)).toBe(INGESTION_MESSAGES.stalePending)
    expect(effectiveErrorMessage(staleProcessing)).toBe(INGESTION_MESSAGES.staleTimeout)
    expect(effectiveErrorMessage(stalePending)).not.toBe(
      effectiveErrorMessage(staleProcessing)
    )
  })
})
