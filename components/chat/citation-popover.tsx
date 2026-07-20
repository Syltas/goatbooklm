"use client"

import { ImageOff } from "lucide-react"
import { useEffect, useState } from "react"

import { getSourceImageUrlAction } from "@/app/(app)/notebooks/[notebookId]/sources/actions"
import { PopoverClose, PopoverContent } from "@/components/ui/popover"
import type { CitationDetail } from "@/lib/chat/types"

import { formatLocator } from "./citation-locator"

interface CitationPopoverContentProps {
  citation: CitationDetail
  /** Only used to gate the image fetch (below) — Radix already decides
   *  DOM presence internally (`Presence`), this is purely "don't fetch a
   *  signed URL for a card nobody can see yet". */
  open: boolean
  onOpenSource: () => void
  /** Forwarded verbatim onto `PopoverContent` — `CitationChip` (the only
   *  caller) uses these to keep a hover-opened card open while the pointer
   *  is over it, and to gate Radix's default focus-in/-return behavior on
   *  HOW the card was opened (mouse hover must never steal focus — see
   *  `CitationChip`'s docstring). Typed as `unknown`-ish `Event`/no-arg
   *  callbacks to match `@radix-ui/react-popover`'s own prop types without
   *  re-importing them here. */
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

/**
 * Image-source thumbnail (Design-Review 2026-07-20 §Teil 2) — same loading
 * idiom as `SourceImage` in `source-reader.tsx` (short-lived signed URL via
 * the owner-checked `getSourceImageUrlAction`, cancellation guard against a
 * stale request painting over a since-closed/reopened card), just sized for
 * an inline popover instead of the full reader. Fetches only once `open` is
 * true — a hover session that never actually opens (mouse passed through
 * before the 350ms delay elapsed) never spends a signed-URL round trip.
 */
function CitationThumbnail({ sourceId, open }: { sourceId: string; open: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setUrl(null)
    setFailed(false)

    getSourceImageUrlAction({ sourceId }).then((result) => {
      if (cancelled) return
      if ("error" in result) setFailed(true)
      else setUrl(result.data.url)
    })

    return () => {
      cancelled = true
    }
  }, [open, sourceId])

  if (failed) {
    // Clean degrade — the passage text below still renders normally, the
    // popover just isn't worth failing over a thumbnail.
    return (
      <div
        className="mb-2 flex h-24 items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary text-xs text-muted-foreground"
        data-test="citation-popover-image-error"
      >
        <ImageOff className="size-3.5 shrink-0" aria-hidden="true" />
        Bild nicht verfügbar
      </div>
    )
  }

  if (!url) {
    return (
      <div
        className="mb-2 h-24 w-full animate-pulse rounded-lg bg-secondary"
        data-test="citation-popover-image-loading"
      />
    )
  }

  // A plain `<img>`, not `next/image`: same reasoning as `SourceImage` in
  // `source-reader.tsx` — a per-request signed Storage URL that's unique on
  // every mint, so the optimizer's cache could never hit anyway.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see comment above
    <img
      src={url}
      alt="Bildquelle"
      className="mb-2 h-24 w-full rounded-lg border border-border object-cover"
      onError={() => setFailed(true)}
      data-test="citation-popover-image"
    />
  )
}

/**
 * The card that opens when a citation chip is activated (hover, click,
 * Enter/Space, or touch tap — see `CitationChip`): source name, locator
 * (page/paragraph), an image thumbnail for image sources, the cited passage
 * (`chunk.content`, clamped), and the "Quelle anzeigen" link/jump-target.
 *
 * Focus-in-on-open and focus-return-on-close (AC-47) are Radix
 * `Popover.Content` defaults for an activation-driven open — `CitationChip`
 * conditionally suppresses them via `onOpenAutoFocus`/`onCloseAutoFocus`
 * when the open was hover-driven (a mouse hover must never steal keyboard
 * focus). "Quelle anzeigen" stays wrapped in `PopoverClose asChild` so it is
 * always the sole focusable descendant — that's what makes Radix's default
 * "focus the first tabbable element" land exactly on it for the keyboard
 * flow (Enter opens → auto-focus lands here → a second Enter jumps).
 */
export function CitationPopoverContent({
  citation,
  open,
  onOpenSource,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onPointerEnter,
  onPointerLeave,
}: CitationPopoverContentProps) {
  const locator = formatLocator(citation)

  return (
    <PopoverContent
      data-test="citation-popover"
      className="space-y-2"
      onOpenAutoFocus={onOpenAutoFocus}
      onCloseAutoFocus={onCloseAutoFocus}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <p className="text-sm font-semibold text-foreground">{citation.sourceTitle}</p>
      {locator && (
        <p className="text-xs text-muted-foreground" data-test="citation-popover-locator">
          {locator}
        </p>
      )}
      {citation.sourceType === "image" && (
        <CitationThumbnail sourceId={citation.sourceId} open={open} />
      )}
      <p className="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">
        {citation.content || "Für dieses Zitat ist kein Passagentext verfügbar."}
      </p>
      <PopoverClose asChild>
        <button
          type="button"
          data-test="citation-popover-open-source"
          className="-mx-1 inline-flex min-h-11 items-center rounded-sm px-1 text-sm font-medium text-[var(--action)] underline-offset-2 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-[var(--action)]"
          onClick={onOpenSource}
        >
          Quelle anzeigen
        </button>
      </PopoverClose>
    </PopoverContent>
  )
}
