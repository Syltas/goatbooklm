"use client"

import { useEffect, useRef, useState } from "react"

const POLL_INTERVAL_MS = 3000
/** Bounded, not infinite — mirrors the DoD's "Fehlerfall bleibt der leere
 *  Chat benutzbar" guarantee: a generation that never completes (a stuck
 *  worker, a permanently-failing Claude call, an operator who deleted the
 *  last ready source moments after upload) must not poll forever. ~2
 *  minutes covers the worker's own 15s cron tick plus a real Claude call
 *  with generous slack, matching the budgets other real-LLM waits in this
 *  app already use (`e2e/sources/sources.po.ts`'s `waitForReady(90_000)`).
 *  Absolute, for one polling session (see `pollingSessionNotebookIdRef`
 *  below) — a mass upload where `readyCount` keeps ticking up does NOT
 *  rearm this budget; it's still the same session waiting on the same
 *  summary. */
const MAX_ATTEMPTS = 40

interface SummaryStatusResponse {
  summary: string | null
  summaryStale: boolean
}

/**
 * Polls `GET /api/notebooks/[notebookId]/summary` while a notebook has
 * `readyCount > 0` but no valid summary yet — the ONLY way the client learns
 * the worker finished generating one (Part A: "die Zusammenfassung steht
 * bereit, bevor der Nutzer den Chat öffnet, kein Kaltstart" describes the
 * common case where a source was already `ready` before this page ever
 * loaded; this hook covers the OTHER case, where the user is watching a
 * fresh upload go through ingestion live).
 *
 * Deliberately a plain scoped `fetch` on an interval, NOT `router.refresh()`
 * — same reasoning as `use-sources-polling.ts`'s own doc comment: a full
 * page refresh would re-render the whole `[notebookId]/page.tsx` tree,
 * including a possibly mid-stream `ChatPanel`, on every tick. This only
 * ever touches its own small piece of local state.
 */
export function useNotebookSummaryPolling(
  notebookId: string,
  readyCount: number,
  initialSummary: string | null
): string | null {
  const [summary, setSummary] = useState(initialSummary)

  // A fresh server-rendered value (e.g. after some OTHER revalidatePath,
  // like a chat turn completing) always wins over whatever this hook's own
  // poll loop found — same "server resync overrides local poll state"
  // precedent as `use-sources-polling.ts`'s `initialSources` effect.
  useEffect(() => {
    setSummary(initialSummary)
  }, [initialSummary])

  const attemptsRef = useRef(0)
  // Bugfix Befund 5: identifies which notebook the CURRENT attempts budget
  // belongs to (`null` while not polling at all). A mass upload flips
  // `readyCount` on every single source's `ready` transition, and each flip
  // re-runs this effect — resetting `attemptsRef` there would make the
  // documented ~2-minute cap (`MAX_ATTEMPTS` above) never actually bind
  // during exactly the scenario it exists for. The budget is reset ONLY
  // when a genuinely NEW polling session starts (summary was resolved/no
  // ready sources, and now isn't) or when it starts for a DIFFERENT
  // notebook — not on every intermediate `readyCount` tick of one already
  // in-progress session.
  const pollingSessionNotebookIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (summary !== null || readyCount === 0) {
      pollingSessionNotebookIdRef.current = null
      return
    }

    if (pollingSessionNotebookIdRef.current !== notebookId) {
      attemptsRef.current = 0
      pollingSessionNotebookIdRef.current = notebookId
    }

    let cancelled = false

    const tick = async () => {
      attemptsRef.current += 1
      try {
        const response = await fetch(`/api/notebooks/${notebookId}/summary`, {
          cache: "no-store",
        })
        if (!response.ok || cancelled) return

        const data = (await response.json()) as SummaryStatusResponse
        if (cancelled) return

        if (!data.summaryStale && data.summary) {
          setSummary(data.summary)
        }
      } catch {
        // Transient network error — the next tick retries; a background
        // poll has no user-facing error state of its own to surface.
      }
    }

    const interval = setInterval(() => {
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        clearInterval(interval)
        return
      }
      void tick()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [summary, readyCount, notebookId])

  return summary
}
