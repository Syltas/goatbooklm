"use client"

import { LayoutGrid, List, Plus, Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Notebook } from "@/lib/notebooks/service"

import { CreateNotebookCard, CreateNotebookRow } from "./create-notebook-tile"
import { DeleteNotebookDialog } from "./delete-notebook-dialog"
import { NotebookCard } from "./notebook-card"
import { NotebookFormDialog } from "./notebook-form-dialog"
import { NotebookListRow } from "./notebook-list-row"

type FormDialogState =
  | { mode: "create" }
  | { mode: "edit"; notebook: Notebook }
  | null

export function NotebookGrid({
  initialNotebooks,
}: {
  initialNotebooks: Notebook[]
}) {
  const [notebooks, setNotebooks] = useState(initialNotebooks)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"grid" | "list">("grid")
  const [formState, setFormState] = useState<FormDialogState>(null)
  const [deletingNotebook, setDeletingNotebook] = useState<Notebook | null>(null)

  // Keep local state in sync whenever the server re-renders this page
  // (e.g. after a mutation's `revalidatePath('/notebooks')`).
  useEffect(() => {
    setNotebooks(initialNotebooks)
  }, [initialNotebooks])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notebooks
    return notebooks.filter((notebook) => notebook.title.toLowerCase().includes(q))
  }, [notebooks, query])

  function handleSaved(notebook: Notebook) {
    setNotebooks((prev) => {
      const exists = prev.some((n) => n.id === notebook.id)
      return exists
        ? prev.map((n) => (n.id === notebook.id ? notebook : n))
        : [notebook, ...prev]
    })
  }

  function handleDeleted(id: string) {
    setNotebooks((prev) => prev.filter((n) => n.id !== id))
  }

  function openCreateDialog() {
    setFormState({ mode: "create" })
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Notizbücher durchsuchen"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-56 pl-8"
            data-test="notebooks-search-input"
          />
        </div>

        <div
          className="flex items-center gap-0.5 rounded-lg border border-border p-0.5"
          data-test="notebooks-view-toggle"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={view === "grid"}
            aria-label="Rasteransicht"
            className={cn(view === "grid" && "bg-muted text-foreground")}
            onClick={() => setView("grid")}
            data-test="notebooks-view-toggle-grid"
          >
            <LayoutGrid />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={view === "list"}
            aria-label="Listenansicht"
            className={cn(view === "list" && "bg-muted text-foreground")}
            onClick={() => setView("list")}
            data-test="notebooks-view-toggle-list"
          >
            <List />
          </Button>
        </div>

        <Button
          type="button"
          onClick={openCreateDialog}
          className="rounded-full"
          data-test="notebooks-create-button"
        >
          <Plus /> Neu erstellen
        </Button>
      </div>

      <h2 className="mt-6 mb-4 text-xl font-medium text-foreground">
        Zuletzt verwendet
      </h2>

      {view === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <CreateNotebookCard onClick={openCreateDialog} />
          {filtered.map((notebook) => (
            <NotebookCard
              key={notebook.id}
              notebook={notebook}
              onEdit={(n) => setFormState({ mode: "edit", notebook: n })}
              onDelete={setDeletingNotebook}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
          <CreateNotebookRow onClick={openCreateDialog} />
          {filtered.map((notebook) => (
            <NotebookListRow
              key={notebook.id}
              notebook={notebook}
              onEdit={(n) => setFormState({ mode: "edit", notebook: n })}
              onDelete={setDeletingNotebook}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 && notebooks.length > 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          Keine Notizbücher gefunden.
        </p>
      )}

      <NotebookFormDialog
        open={formState !== null}
        onOpenChange={(open) => !open && setFormState(null)}
        mode={formState?.mode ?? "create"}
        notebook={formState?.mode === "edit" ? formState.notebook : null}
        onSaved={handleSaved}
      />

      <DeleteNotebookDialog
        notebook={deletingNotebook}
        onOpenChange={(open) => !open && setDeletingNotebook(null)}
        onDeleted={handleDeleted}
      />
    </div>
  )
}
