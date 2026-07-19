"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

/**
 * Reader-Mode state for the Sources-Panel (specs/02-ingestion.md §16) —
 * lives at the Detail-Shell level (not inside the sources feature folder)
 * because it's an imperative entry point future consumers reach into from
 * OUTSIDE the Sources-Panel: Spec 03's citation popover "Quelle
 * anzeigen"-Link calls `openSource(sourceId, { charStart, charEnd })` from
 * the Chat panel to jump the Sources-Panel into Reader-Mode at a specific
 * offset (AC-44) — today (this spec) the only caller is a source-row click
 * inside the panel itself, with no offsets.
 *
 * Both the desktop and the mobile-sheet mount of the Sources-Panel body
 * (see `notebook-detail-shell.tsx`) read this SAME context instance, so a
 * `openSource` call from either — or later from Chat — is reflected
 * consistently in whichever one is actually visible at the current
 * viewport.
 */

interface OpenSourceOptions {
  charStart?: number
  charEnd?: number
}

interface SourceReaderState {
  sourceId: string | null
  charStart?: number
  charEnd?: number
}

interface SourceReaderContextValue extends SourceReaderState {
  openSource: (sourceId: string, options?: OpenSourceOptions) => void
  closeSource: () => void
}

const SourceReaderContext = createContext<SourceReaderContextValue | null>(
  null
)

export function SourceReaderProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [state, setState] = useState<SourceReaderState>({ sourceId: null })

  const openSource = useCallback(
    (sourceId: string, options?: OpenSourceOptions) => {
      setState({
        sourceId,
        charStart: options?.charStart,
        charEnd: options?.charEnd,
      })
    },
    []
  )

  const closeSource = useCallback(() => setState({ sourceId: null }), [])

  const value = useMemo<SourceReaderContextValue>(
    () => ({ ...state, openSource, closeSource }),
    [state, openSource, closeSource]
  )

  return (
    <SourceReaderContext.Provider value={value}>
      {children}
    </SourceReaderContext.Provider>
  )
}

export function useSourceReader(): SourceReaderContextValue {
  const ctx = useContext(SourceReaderContext)
  if (!ctx) {
    throw new Error("useSourceReader must be used within a SourceReaderProvider")
  }
  return ctx
}
