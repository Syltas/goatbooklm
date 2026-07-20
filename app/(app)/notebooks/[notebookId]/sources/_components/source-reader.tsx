"use client"

import { ArrowLeft, ImageOff } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

import { getSourceImageUrlAction } from "../actions"
import type { SourceWithChunkCount } from "../types"

/**
 * Reader-Mode of the Sources-Panel (specs/02-ingestion.md §16) — shows
 * `content_text` for one source, optionally scrolled + `<mark>`-highlighted
 * to a `[charStart, charEnd)` range (AC-44, driven by
 * `useSourceReader()`/Spec 03's future citation-popover callback).
 *
 * Performance (AC-45, up to 500.000 chars): rather than one giant DOM text
 * node, the text is split into ~2000-char segments snapped to the nearest
 * paragraph/word boundary, each wrapped in `content-visibility: auto` — the
 * browser skips layout/paint work for off-screen segments without a
 * virtualization library (the task brief explicitly names this as an
 * acceptable v1 approach: "z.B. Absatz-Splitting, CSS content-visibility").
 */

const SEGMENT_TARGET_SIZE = 2000
const BOUNDARY_SEARCH_WINDOW = 200

interface Segment {
  index: number
  start: number
  end: number
  text: string
}

function segmentText(text: string): Segment[] {
  if (text.length === 0) return []

  const segments: Segment[] = []
  let start = 0
  let index = 0

  while (start < text.length) {
    let end = Math.min(start + SEGMENT_TARGET_SIZE, text.length)

    if (end < text.length) {
      const nextNewline = text.indexOf("\n", end)
      if (nextNewline !== -1 && nextNewline - end < BOUNDARY_SEARCH_WINDOW) {
        end = nextNewline + 1
      } else {
        const nextSpace = text.indexOf(" ", end)
        if (nextSpace !== -1 && nextSpace - end < BOUNDARY_SEARCH_WINDOW) {
          end = nextSpace + 1
        }
      }
    }

    segments.push({ index, start, end, text: text.slice(start, end) })
    start = end
    index += 1
  }

  return segments
}

function renderSegment(
  segment: Segment,
  charStart: number | undefined,
  charEnd: number | undefined,
  highlightRef: React.RefObject<HTMLElement | null>
): React.ReactNode {
  const hasRange =
    typeof charStart === "number" &&
    typeof charEnd === "number" &&
    charEnd > charStart

  const overlaps =
    hasRange && charEnd! > segment.start && charStart! < segment.end

  if (!overlaps) return segment.text

  const localStart = Math.max(0, charStart! - segment.start)
  const localEnd = Math.min(segment.text.length, charEnd! - segment.start)
  const isStartSegment = charStart! >= segment.start && charStart! < segment.end

  return (
    <>
      {segment.text.slice(0, localStart)}
      <mark
        ref={isStartSegment ? highlightRef : undefined}
        data-test="source-reader-highlight"
        className="rounded-sm bg-[var(--highlight)] px-0.5 motion-safe:animate-[source-highlight-pulse_600ms_ease-out]"
      >
        {segment.text.slice(localStart, localEnd)}
      </mark>
      {segment.text.slice(localEnd)}
    </>
  )
}

/**
 * Image sources need the image itself above the text, because their
 * `content_text` is not the source — it is a model-written description OF
 * the source (see `lib/ingestion/extractors/image.ts`). Showing only that
 * text would mean a citation click lands the user in generated prose with
 * the actual evidence nowhere on screen, which is exactly the thing the
 * reader exists to prevent.
 *
 * The file lives in a private bucket, so it is fetched through
 * `getSourceImageUrlAction` — a Server Action that resolves the owner from
 * the session and mints a short-lived signed URL. Nothing about the image is
 * reachable without being its owner.
 */
function SourceImage({ sourceId }: { sourceId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    setUrl(null)
    setFailed(false)

    getSourceImageUrlAction({ sourceId }).then((result) => {
      // Guard against a resolved request for a source the user has already
      // navigated away from — otherwise switching sources quickly can paint
      // the previous source's image under the current source's description.
      if (cancelled) return
      if ("error" in result) setFailed(true)
      else setUrl(result.data.url)
    })

    return () => {
      cancelled = true
    }
  }, [sourceId])

  if (failed) {
    return (
      <div
        className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2.5 text-sm text-muted-foreground"
        data-test="source-reader-image-error"
      >
        <ImageOff className="size-4 shrink-0" aria-hidden="true" />
        Bild konnte nicht geladen werden.
      </div>
    )
  }

  if (!url) {
    // Reserve space while the signed URL is in flight so the description
    // below doesn't jump once the image lands.
    return (
      <div
        className="mb-4 h-48 animate-pulse rounded-lg border border-border bg-secondary"
        data-test="source-reader-image-loading"
      />
    )
  }

  // A plain `<img>`, not `next/image`: the source is a per-request signed
  // Storage URL, which `next/image` cannot optimize usefully — it would need
  // the Storage host in `images.remotePatterns`, and because the signature
  // makes every URL unique the optimizer cache could never hit anyway.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see comment above
    <img
      src={url}
      alt="Bildquelle"
      className="mb-4 max-h-[60vh] w-full rounded-lg border border-border object-contain"
      onError={() => setFailed(true)}
      data-test="source-reader-image"
    />
  )
}

interface SourceReaderProps {
  source: SourceWithChunkCount
  charStart?: number
  charEnd?: number
  /** Set only right after a `goBack()` (Design-Review 2026-07-20, §Teil 5
   *  precondition) — restores the exact scroll position the user was at
   *  before they navigated away, instead of the normal
   *  scroll-to-highlight behavior below. `undefined` for a fresh
   *  `openSource()` open (including the very first one). */
  restoreScrollTop?: number
  /** Whether `onBack` restores a PREVIOUS source rather than returning to
   *  the list — only changes the button's `aria-label` so it says what it's
   *  actually about to do. */
  canGoBack: boolean
  onBack: () => void
  /** Reports this container's `scrollTop` to `SourceReaderContext` on every
   *  scroll, so a later `openSource`/`goBack` call can snapshot "where the
   *  user was" onto its back-path entry. */
  onScroll: (scrollTop: number) => void
}

export function SourceReader({
  source,
  charStart,
  charEnd,
  restoreScrollTop,
  canGoBack,
  onBack,
  onScroll,
}: SourceReaderProps) {
  const content = source.content_text ?? ""
  const segments = useMemo(() => segmentText(content), [content])
  const highlightRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const isImage = source.type === "image"

  const hasHighlight =
    typeof charStart === "number" &&
    typeof charEnd === "number" &&
    charEnd > charStart

  useEffect(() => {
    // A `goBack()` restore wins over the normal scroll-to-highlight: the
    // point of the back-path is returning to where the user actually WAS,
    // not re-centering on a citation they may have scrolled away from since.
    // The `<mark>` (if `hasHighlight`) still renders either way — only the
    // scroll target differs.
    if (typeof restoreScrollTop === "number" && contentRef.current) {
      contentRef.current.scrollTop = restoreScrollTop
      return
    }
    if (hasHighlight && highlightRef.current) {
      // AC-48 (Design-Review 2026-07-19): under `prefers-reduced-motion:
      // reduce`, the citation jump scrolls instantly instead of
      // smooth-scrolling — the highlight-pulse keyframe is already gated by
      // `motion-safe:` above.
      const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      highlightRef.current.scrollIntoView({
        block: "center",
        behavior: reducedMotion ? "auto" : "smooth",
      })
    }
    // Deliberately re-runs only on source/offset changes, not on every
    // `segments` recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, charStart, charEnd, restoreScrollTop])

  return (
    <div className="flex h-full flex-col" data-test="source-reader">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label={canGoBack ? "Zurück zur vorherigen Quelle" : "Zurück zur Quellenliste"}
          data-test="source-reader-back"
        >
          <ArrowLeft />
        </Button>
        <p className="truncate text-sm font-medium text-foreground">{source.title}</p>
      </div>

      <div
        ref={contentRef}
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[15px] leading-[1.6] whitespace-pre-wrap text-foreground"
        data-test="source-reader-content"
      >
        {isImage && <SourceImage sourceId={source.id} />}

        {isImage && segments.length > 0 && (
          <p className="mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Beschreibung
          </p>
        )}

        {segments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Für diese Quelle ist noch kein Volltext verfügbar.
          </p>
        ) : (
          // Unchanged for image sources: the description is segmented and
          // `<mark>`-highlighted exactly like any other source's text, so a
          // citation into an image's description still scrolls to and
          // highlights the cited passage — it just now sits under the image
          // it describes.
          segments.map((segment) => (
            <p key={segment.index} className="mb-4 [content-visibility:auto]">
              {renderSegment(segment, charStart, charEnd, highlightRef)}
            </p>
          ))
        )}
      </div>
    </div>
  )
}
