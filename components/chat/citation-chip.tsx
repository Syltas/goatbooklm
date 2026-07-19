"use client"

import { Popover, PopoverTrigger } from "@/components/ui/popover"
import type { CitationDetail } from "@/lib/chat/types"

import { CitationPopoverContent } from "./citation-popover"

export interface OnCiteArgs {
  sourceId: string
  charStart?: number
  charEnd?: number
}

interface CitationChipProps {
  citation: CitationDetail
  onCite: (args: OnCiteArgs) => void
}

/**
 * Inline `[n]` marker rendered as a small, dezent `<button>` (never a
 * `<span>` — AC-G3/AC-45) that opens the citation popover on click or
 * keyboard activation (Enter/Space are native `<button>` behavior). Klick
 * auf „Quelle anzeigen" im Popover — not the chip itself — is what fires
 * `onCite` (§7, Popover-first).
 */
export function CitationChip({ citation, onCite }: CitationChipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-test="citation-chip"
          data-citation-n={citation.n}
          aria-label={`Quelle ${citation.n} anzeigen`}
          className="relative mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 align-super text-[11px] leading-none font-medium text-[var(--action)] outline-none after:absolute after:-inset-3.5 after:content-[''] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--action)]"
        >
          {citation.n}
        </button>
      </PopoverTrigger>
      <CitationPopoverContent
        citation={citation}
        onOpenSource={() =>
          onCite({
            sourceId: citation.sourceId,
            charStart: citation.charStart,
            charEnd: citation.charEnd,
          })
        }
      />
    </Popover>
  )
}
