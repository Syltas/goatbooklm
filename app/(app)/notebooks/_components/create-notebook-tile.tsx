"use client"

import { Plus } from "lucide-react"

interface CreateNotebookTileProps {
  onClick: () => void
}

/**
 * The dashed "create" tile is always the first item in the grid/list AND
 * doubles as the empty-state CTA (AC-9, AC-39, AC-40) — same element, same
 * `data-test`, regardless of how many notebooks exist.
 */
export function CreateNotebookCard({ onClick }: CreateNotebookTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-test="notebooks-empty-cta"
      className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Plus className="size-5" />
      </span>
      <span className="text-sm font-medium">Neues Notizbuch erstellen</span>
    </button>
  )
}

export function CreateNotebookRow({ onClick }: CreateNotebookTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-test="notebooks-empty-cta"
      className="flex items-center gap-3 px-4 py-3 text-left text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-muted">
        <Plus className="size-4" />
      </span>
      <span className="text-sm font-medium">Neues Notizbuch erstellen</span>
    </button>
  )
}
