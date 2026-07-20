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
      className="flex min-h-[216px] flex-col items-center justify-center gap-3 rounded-[20px] border-[1.5px] border-dashed border-[#d9d5cd] text-muted-foreground transition-colors duration-150 hover:border-foreground hover:bg-white/60 hover:text-foreground"
    >
      <span className="flex size-11 items-center justify-center rounded-full border border-border bg-card">
        <Plus className="size-[18px]" />
      </span>
      <span className="text-sm font-bold">Neues Notizbuch</span>
    </button>
  )
}

export function CreateNotebookRow({ onClick }: CreateNotebookTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-test="notebooks-empty-cta"
      className="flex items-center gap-3.5 rounded-[14px] px-3.5 py-3 text-left text-muted-foreground hover:bg-background hover:text-foreground"
    >
      <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full border border-dashed border-[#d9d5cd]">
        <Plus className="size-4" />
      </span>
      <span className="text-sm font-bold">Neues Notizbuch erstellen</span>
    </button>
  )
}
