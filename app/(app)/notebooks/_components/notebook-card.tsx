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
      className="relative isolate flex min-h-[216px] flex-col justify-between overflow-hidden rounded-[20px] border border-[#eceae4] bg-card p-[18px] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-14px_rgba(35,33,30,0.28)]"
      data-test={`notebook-card-${notebook.id}`}
    >
      <Link
        href={`/notebooks/${notebook.id}`}
        className="absolute inset-0 z-10 rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-test={`notebook-card-link-${notebook.id}`}
      >
        <span className="sr-only">{notebook.title} öffnen</span>
      </Link>

      <div className="flex items-start justify-between">
        <span
          className="flex size-[46px] items-center justify-center rounded-[14px] text-[22px]"
          style={{ backgroundColor: getNotebookCardColor(notebook.id) }}
          aria-hidden="true"
        >
          {NOTEBOOK_DEFAULT_EMOJI}
        </span>
        <NotebookCardMenu
          notebook={notebook}
          onEdit={onEdit}
          onDelete={onDelete}
          className="relative z-20 size-[30px] rounded-full text-[#a8a29b] hover:bg-muted hover:text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <h3
          className="line-clamp-2 text-[17px] leading-[1.4] font-bold tracking-[-0.005em] text-foreground"
          data-test={`notebook-card-title-${notebook.id}`}
        >
          {notebook.title}
        </h3>
        <p className="line-clamp-1 text-[13px] text-muted-foreground">
          {formatNotebookDate(notebook.created_at)} ·{" "}
          {notebook.description?.trim() || "Keine Beschreibung"}
        </p>
      </div>
    </div>
  )
}
