"use client"

import Link from "next/link"

import {
  NOTEBOOK_DEFAULT_EMOJI,
  formatNotebookDate,
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
      className="relative isolate flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
      data-test={`notebook-card-${notebook.id}`}
    >
      <Link
        href={`/notebooks/${notebook.id}`}
        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-test={`notebook-card-link-${notebook.id}`}
      >
        <span className="sr-only">{notebook.title} öffnen</span>
      </Link>

      <span className="text-xl" aria-hidden="true">
        {NOTEBOOK_DEFAULT_EMOJI}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-foreground"
          data-test={`notebook-card-title-${notebook.id}`}
        >
          {notebook.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatNotebookDate(notebook.created_at)} ·{" "}
          {notebook.description?.trim() || "Keine Beschreibung"}
        </p>
      </div>

      <NotebookCardMenu
        notebook={notebook}
        onEdit={onEdit}
        onDelete={onDelete}
        className="relative z-20"
      />
    </div>
  )
}
