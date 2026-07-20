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
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-14">
      <h1 className="mb-7 font-heading text-[34px] font-bold tracking-[-0.015em] text-foreground">
        Willkommen zurück 👋
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={openCreateDialog}
          className="h-10 gap-1.5 rounded-full pr-5 pl-4 text-[14.5px] font-bold"
          data-test="notebooks-create-button"
        >
          <Plus /> Neu erstellen
        </Button>

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-[14px] size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Notizbücher durchsuchen"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 w-[260px] rounded-full border-border bg-card py-1 pr-4 pl-[38px] text-sm"
            data-test="notebooks-search-input"
          />
        </div>

        <div
          className="flex items-center gap-0.5 rounded-full border border-border bg-card p-[3px]"
          data-test="notebooks-view-toggle"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={view === "grid"}
            aria-label="Rasteransicht"
            className={cn(
              "size-8 rounded-full",
              view === "grid" && "bg-muted text-foreground"
            )}
            onClick={() => setView("grid")}
            data-test="notebooks-view-toggle-grid"
          >
            <LayoutGrid size={15} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={view === "list"}
            aria-label="Listenansicht"
            className={cn(
              "size-8 rounded-full",
              view === "list" && "bg-muted text-foreground"
            )}
            onClick={() => setView("list")}
            data-test="notebooks-view-toggle-list"
          >
            <List size={15} />
          </Button>
        </div>
      </div>

      <h2 className="mt-9 mb-4 text-[15px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
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
        <div className="flex flex-col rounded-[20px] border border-[#eceae4] bg-card p-1.5">
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
