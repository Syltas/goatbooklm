import { PopoverContent } from "@/components/ui/popover"
import type { CitationDetail } from "@/lib/chat/types"

interface CitationPopoverContentProps {
  citation: CitationDetail
  onOpenSource: () => void
}

/**
 * §7 Highlight-Bridge (Popover-first, Design-Review 2026-07-19) — the
 * card that opens when a citation chip is activated: source name, the cited
 * passage (`chunk.content`, clamped), and the "Quelle anzeigen" link that
 * triggers the reader jump. Focus-in-on-open / focus-return-on-close (AC-47)
 * and Esc-to-close are Radix `Popover.Content` defaults — no extra wiring
 * needed here.
 */
export function CitationPopoverContent({
  citation,
  onOpenSource,
}: CitationPopoverContentProps) {
  return (
    <PopoverContent data-test="citation-popover" className="space-y-2">
      <p className="text-sm font-semibold text-foreground">{citation.sourceTitle}</p>
      <p className="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">
        {citation.content || "Für dieses Zitat ist kein Passagentext verfügbar."}
      </p>
      <button
        type="button"
        data-test="citation-popover-open-source"
        className="-mx-1 inline-flex min-h-11 items-center rounded-sm px-1 text-sm font-medium text-[var(--action)] underline-offset-2 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-[var(--action)]"
        onClick={onOpenSource}
      >
        Quelle anzeigen
      </button>
    </PopoverContent>
  )
}
