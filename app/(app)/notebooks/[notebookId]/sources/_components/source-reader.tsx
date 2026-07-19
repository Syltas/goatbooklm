"use client"

import { ArrowLeft } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"

import { Button } from "@/components/ui/button"

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

interface SourceReaderProps {
  source: SourceWithChunkCount
  charStart?: number
  charEnd?: number
  onBack: () => void
}

export function SourceReader({
  source,
  charStart,
  charEnd,
  onBack,
}: SourceReaderProps) {
  const content = source.content_text ?? ""
  const segments = useMemo(() => segmentText(content), [content])
  const highlightRef = useRef<HTMLElement | null>(null)

  const hasHighlight =
    typeof charStart === "number" &&
    typeof charEnd === "number" &&
    charEnd > charStart

  useEffect(() => {
    if (hasHighlight && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: "center", behavior: "smooth" })
    }
    // Deliberately re-runs only on source/offset changes, not on every
    // `segments` recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, charStart, charEnd])

  return (
    <div className="flex h-full flex-col" data-test="source-reader">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Zurück zur Quellenliste"
          data-test="source-reader-back"
        >
          <ArrowLeft />
        </Button>
        <p className="truncate text-sm font-medium text-foreground">{source.title}</p>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[15px] leading-[1.6] whitespace-pre-wrap text-foreground"
        data-test="source-reader-content"
      >
        {segments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Für diese Quelle ist noch kein Volltext verfügbar.
          </p>
        ) : (
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
