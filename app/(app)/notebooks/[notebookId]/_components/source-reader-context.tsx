"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"

/**
 * Reader-Mode state for the Sources-Panel (specs/02-ingestion.md §16) —
 * lives at the Detail-Shell level (not inside the sources feature folder)
 * because it's an imperative entry point future consumers reach into from
 * OUTSIDE the Sources-Panel: Spec 03's citation chip calls
 * `openSource(sourceId, { charStart, charEnd })` from the Chat panel to jump
 * the Sources-Panel into Reader-Mode at a specific offset (AC-44) — today
 * the other caller is a source-row click inside the panel itself, with no
 * offsets.
 *
 * Both the desktop and the mobile-sheet mount of the Sources-Panel body
 * (see `notebook-detail-shell.tsx`) read this SAME context instance, so an
 * `openSource` call from either — or from Chat — is reflected consistently
 * in whichever one is actually visible at the current viewport.
 *
 * **Back-path (Design-Review 2026-07-20 — precondition for §Teil 5's direct
 * citation-click jump):** a single `previous` slot (not a full history
 * stack — "der vorherigen Zustand", singular) remembers the source, offsets,
 * and scroll position that were showing right before the CURRENT
 * `openSource` call. Without this, a mis-click on a 16px inline citation
 * target silently discarded whatever the user was reading — including
 * their scroll position — with the only way back being the source list, not
 * where they'd been. `goBack()` restores that one prior view and consumes
 * it (a second `goBack()` falls through to `closeSource()`'s "return to the
 * list", same as when there was never a previous view).
 */

interface OpenSourceOptions {
  charStart?: number
  charEnd?: number
  /** Only consumed for the live-region announcement below — the context
   *  has no other use for a source's display name and never fetches one
   *  itself. Omit it and `openSource` just doesn't announce (e.g. the
   *  existing source-row-click call site, which already has the row
   *  visible on screen and doesn't need a screen-reader announcement to
   *  the same degree a cross-panel chat jump does). */
  sourceTitle?: string
}

interface SourceReaderEntry {
  sourceId: string
  charStart?: number
  charEnd?: number
  scrollTop?: number
}

interface SourceReaderState {
  sourceId: string | null
  charStart?: number
  charEnd?: number
  /** Set only by `goBack()` — the scroll position `SourceReader` should
   *  restore instead of running its normal charStart/charEnd
   *  scroll-to-highlight behavior. `undefined` for a fresh `openSource()`
   *  open. */
  restoreScrollTop?: number
  previous: SourceReaderEntry | null
}

interface SourceReaderContextValue
  extends Omit<SourceReaderState, "previous"> {
  /** Whether `goBack()` would restore a previous view (vs. falling through
   *  to the source list) — drives the back button's label/affordance. */
  canGoBack: boolean
  openSource: (sourceId: string, options?: OpenSourceOptions) => void
  closeSource: () => void
  goBack: () => void
  /** `SourceReader`'s scrollable content div calls this on every scroll —
   *  a cheap ref write, not state, so it doesn't force a re-render per
   *  pixel scrolled. Read back the moment `openSource`/`goBack` next needs
   *  to snapshot "whatever was showing a moment ago" onto `previous`. */
  reportScroll: (scrollTop: number) => void
}

const SourceReaderContext = createContext<SourceReaderContextValue | null>(
  null
)

export function SourceReaderProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [state, setState] = useState<SourceReaderState>({
    sourceId: null,
    previous: null,
  })
  // Continuously updated by `reportScroll` — deliberately a ref, not state
  // (see that prop's docstring above).
  const currentScrollRef = useRef<number | undefined>(undefined)

  // Screen-reader announcement for a citation-driven jump (§Teil 5,
  // "Live-Region: ein Sprung meldet sich höflich an"). Reset to "" and then
  // set a frame later so two consecutive jumps to the SAME source still get
  // re-announced — an `aria-live` region only speaks on a text CHANGE, and
  // writing the identical string twice in a row wouldn't otherwise count as
  // one.
  const [announcement, setAnnouncement] = useState("")

  const announce = useCallback((text: string) => {
    setAnnouncement("")
    requestAnimationFrame(() => setAnnouncement(text))
  }, [])

  const openSource = useCallback(
    (sourceId: string, options?: OpenSourceOptions) => {
      // Captured into a local BEFORE the state update, not read from inside
      // a `setState` updater — React may invoke a functional updater later
      // than this call site, by which point a ref reset on the very next
      // line would already have raced past it. A plain captured variable
      // has no such timing hazard.
      const priorScrollTop = currentScrollRef.current
      currentScrollRef.current = undefined

      setState({
        sourceId,
        charStart: options?.charStart,
        charEnd: options?.charEnd,
        restoreScrollTop: undefined,
        // Snapshot whatever was showing before this call as `previous` —
        // only if something WAS showing (a first-ever open has nothing to
        // remember). Overwrites any older `previous`: this is a single
        // undo slot, not an unbounded history (see the module docstring).
        previous: state.sourceId
          ? {
              sourceId: state.sourceId,
              charStart: state.charStart,
              charEnd: state.charEnd,
              scrollTop: priorScrollTop,
            }
          : state.previous,
      })

      if (options?.sourceTitle) {
        announce(`Reader-Mode geöffnet: ${options.sourceTitle}`)
      }
    },
    [state, announce]
  )

  const goBack = useCallback(() => {
    const previous = state.previous
    if (!previous) {
      currentScrollRef.current = undefined
      setState({ sourceId: null, previous: null })
      return
    }
    currentScrollRef.current = previous.scrollTop
    setState({
      sourceId: previous.sourceId,
      charStart: previous.charStart,
      charEnd: previous.charEnd,
      restoreScrollTop: previous.scrollTop,
      previous: null,
    })
  }, [state])

  const closeSource = useCallback(() => {
    currentScrollRef.current = undefined
    setState({ sourceId: null, previous: null })
  }, [])

  const reportScroll = useCallback((scrollTop: number) => {
    currentScrollRef.current = scrollTop
  }, [])

  const value = useMemo<SourceReaderContextValue>(
    () => ({
      sourceId: state.sourceId,
      charStart: state.charStart,
      charEnd: state.charEnd,
      restoreScrollTop: state.restoreScrollTop,
      canGoBack: state.previous !== null,
      openSource,
      closeSource,
      goBack,
      reportScroll,
    }),
    [state, openSource, closeSource, goBack, reportScroll]
  )

  return (
    <SourceReaderContext.Provider value={value}>
      {children}
      {/* Screen-reader-only (§Teil 5 "Live-Region") — a citation jump swaps
          the visible panel without moving keyboard focus there (a desktop
          click keeps focus on the chat's chip), so without this a
          screen-reader user gets no signal that anything happened at all. */}
      <div aria-live="polite" className="sr-only" data-test="source-reader-live-region">
        {announcement}
      </div>
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
