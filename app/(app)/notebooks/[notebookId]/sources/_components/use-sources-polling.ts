"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { isNonFinal } from "@/lib/ingestion/source-status"

import type { SourceWithChunkCount } from "../types"

const POLL_INTERVAL_MS = 2000

interface StatusRow {
  id: string
  status: "pending" | "processing" | "ready" | "error"
  errorMessage: string | null
  updatedAt: string
  chunkCount: number
}

/**
 * Owns the Sources-Panel's live list state (specs/02-ingestion.md §4 Punkt
 * 5/OV8, AC-31). Two update paths feed the same local array:
 *
 * 1. Server-driven resync — whenever `initialSources` changes (a fresh
 *    Server Component render after some action's `revalidatePath`, e.g.
 *    add/delete), matching `NotebookGrid`'s established pattern.
 * 2. The 2s poll loop below, active only while ≥1 source is non-final
 *    (AC-31) — hits the scoped `GET
 *    /api/notebooks/[notebookId]/sources/status` endpoint and PATCHES just
 *    `status`/`error_message`/`updated_at`/chunk-count onto matching rows.
 *    Deliberately a plain `fetch`, not a Server Action — it must NOT call
 *    `router.refresh()` on every tick (OV8: that would re-render the whole
 *    page tree, including a possibly-mid-stream Chat panel). A single
 *    `router.refresh()` fires only on the pending/processing → all-final
 *    transition, to pick up anything the scoped endpoint doesn't carry
 *    (e.g. a web source's title getting backfilled from the page's
 *    `<title>`).
 *
 * `addSource`/`removeSource` let the Add-Source dialog and the delete flow
 * update the list immediately (same snappy-UX pattern as
 * `notebook-grid.tsx`'s `handleSaved`/`handleDeleted`) instead of waiting
 * on the next server resync.
 */
export function useSourcesPolling(
  notebookId: string,
  initialSources: SourceWithChunkCount[]
) {
  const [sources, setSources] = useState(initialSources)
  const router = useRouter()
  const wasPollingRef = useRef(false)

  useEffect(() => {
    setSources(initialSources)
  }, [initialSources])

  const hasNonFinal = sources.some((source) => isNonFinal(source))

  useEffect(() => {
    if (!hasNonFinal) {
      if (wasPollingRef.current) {
        wasPollingRef.current = false
        router.refresh()
      }
      return
    }

    wasPollingRef.current = true
    let cancelled = false

    const tick = async () => {
      try {
        const response = await fetch(
          `/api/notebooks/${notebookId}/sources/status`,
          { cache: "no-store" }
        )
        if (!response.ok || cancelled) return

        const rows = (await response.json()) as StatusRow[]
        if (cancelled) return

        setSources((prev) =>
          prev.map((source) => {
            const match = rows.find((row) => row.id === source.id)
            if (!match) return source
            return {
              ...source,
              status: match.status,
              error_message: match.errorMessage,
              updated_at: match.updatedAt,
              chunks: [{ count: match.chunkCount }],
            }
          })
        )
      } catch {
        // Transient network error — the next tick retries; no need to
        // surface this as a UI error for a background poll.
      }
    }

    const interval = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [hasNonFinal, notebookId, router])

  const addSource = useCallback((source: SourceWithChunkCount) => {
    setSources((prev) => [source, ...prev])
  }, [])

  const removeSource = useCallback((sourceId: string) => {
    setSources((prev) => prev.filter((source) => source.id !== sourceId))
  }, [])

  return { sources, addSource, removeSource }
}
