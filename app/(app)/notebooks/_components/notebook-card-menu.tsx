"use client"

import { MoreVertical, Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Notebook } from "@/lib/notebooks/service"

interface NotebookCardMenuProps {
  notebook: Notebook
  onEdit: (notebook: Notebook) => void
  onDelete: (notebook: Notebook) => void
  className?: string
}

export function NotebookCardMenu({
  notebook,
  onEdit,
  onDelete,
  className,
}: NotebookCardMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={className}
          data-test={`notebook-card-menu-${notebook.id}`}
          aria-label={`Optionen für ${notebook.title}`}
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-test={`notebook-card-edit-${notebook.id}`}
          onSelect={() => onEdit(notebook)}
        >
          <Pencil /> Bearbeiten
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          data-test={`notebook-card-delete-${notebook.id}`}
          onSelect={() => onDelete(notebook)}
        >
          <Trash2 /> Löschen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
