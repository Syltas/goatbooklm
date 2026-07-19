"use client"

import Link from "next/link"

import {
  NOTEBOOK_DEFAULT_EMOJI,
  formatNotebookDate,
  getNotebookCardColor,
} from "@/lib/notebooks/presentation"
import type { Notebook } from "@/lib/notebooks/service"

import { NotebookCardMenu } from "./notebook-card-menu"

interface NotebookCardProps {
  notebook: Notebook
  onEdit: (notebook: Notebook) => void
  onDelete: (notebook: Notebook) => void
}

export function NotebookCard({ notebook, onEdit, onDelete }: NotebookCardProps) {
  return (
    <div
      className="relative isolate flex min-h-[220px] flex-col justify-between overflow-hidden rounded-2xl p-4"
      style={{ backgroundColor: getNotebookCardColor(notebook.id) }}
      data-test={`notebook-card-${notebook.id}`}
    >
      <Link
        href={`/notebooks/${notebook.id}`}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-test={`notebook-card-link-${notebook.id}`}
      >
        <span className="sr-only">{notebook.title} öffnen</span>
      </Link>

      <div className="flex items-start justify-between">
        <span className="text-3xl" aria-hidden="true">
          {NOTEBOOK_DEFAULT_EMOJI}
        </span>
        <NotebookCardMenu
          notebook={notebook}
          onEdit={onEdit}
          onDelete={onDelete}
          className="relative z-20 text-foreground/60 hover:bg-black/5 hover:text-foreground"
        />
      </div>

      <div className="mt-10 space-y-1">
        <h3
          className="line-clamp-2 text-base font-medium text-foreground"
          data-test={`notebook-card-title-${notebook.id}`}
        >
          {notebook.title}
        </h3>
        <p className="line-clamp-1 text-sm text-foreground/70">
          {formatNotebookDate(notebook.created_at)} ·{" "}
          {notebook.description?.trim() || "Keine Beschreibung"}
        </p>
      </div>
    </div>
  )
}
