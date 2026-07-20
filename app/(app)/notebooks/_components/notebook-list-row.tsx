"use client"

import Link from "next/link"

import {
  NOTEBOOK_DEFAULT_EMOJI,
  formatNotebookDate,
  getNotebookCardColor,
} from "@/lib/notebooks/presentation"
import type { Notebook } from "@/lib/notebooks/service"

import { NotebookCardMenu } from "./notebook-card-menu"

interface NotebookListRowProps {
  notebook: Notebook
  onEdit: (notebook: Notebook) => void
  onDelete: (notebook: Notebook) => void
}

export function NotebookListRow({
  notebook,
  onEdit,
  onDelete,
}: NotebookListRowProps) {
  return (
    <div
      className="relative isolate flex items-center gap-3.5 rounded-[14px] px-3.5 py-3 hover:bg-background"
      data-test={`notebook-card-${notebook.id}`}
    >
      <Link
        href={`/notebooks/${notebook.id}`}
        className="absolute inset-0 z-10 rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-test={`notebook-card-link-${notebook.id}`}
      >
        <span className="sr-only">{notebook.title} öffnen</span>
      </Link>

      <span
        className="flex size-[38px] shrink-0 items-center justify-center rounded-[12px] text-[18px]"
        style={{ backgroundColor: getNotebookCardColor(notebook.id) }}
        aria-hidden="true"
      >
        {NOTEBOOK_DEFAULT_EMOJI}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[14.5px] font-bold text-foreground"
          data-test={`notebook-card-title-${notebook.id}`}
        >
          {notebook.title}
        </p>
        <p className="truncate text-[12.5px] text-muted-foreground">
          {formatNotebookDate(notebook.created_at)} ·{" "}
          {notebook.description?.trim() || "Keine Beschreibung"}
        </p>
      </div>

      <NotebookCardMenu
        notebook={notebook}
        onEdit={onEdit}
        onDelete={onDelete}
        className="relative z-20 size-[30px] rounded-full text-[#a8a29b] hover:bg-muted hover:text-foreground"
      />
    </div>
  )
}
