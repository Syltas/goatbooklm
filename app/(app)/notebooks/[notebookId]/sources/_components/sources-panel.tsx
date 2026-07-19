"use client"

import { Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { useSourceReader } from "../../_components/source-reader-context"
import type { SourceWithChunkCount } from "../types"
import { AddSourceDialog } from "./add-source-dialog"
import { DeleteSourceDialog } from "./delete-source-dialog"
import { SourceList } from "./source-list"
import { SourceReader } from "./source-reader"

interface SourcesPanelProps {
  notebookId: string
  sources: SourceWithChunkCount[]
  onCreated: (source: SourceWithChunkCount) => void
  onDeleted: (sourceId: string) => void
}

/**
 * Body of the Sources-Panel (replaces the Spec 01 placeholder) — toggles
 * between Listen-Mode (default) and Reader-Mode of one open source
 * (specs/02-ingestion.md §16, AC-50/AC-51), driven by the shared
 * `useSourceReader()` context so a `openSource()` call from anywhere (a
 * row click here today; Spec 03's citation popover later) is reflected
 * identically whether this instance is the desktop mount or the
 * mobile-sheet mount (`notebook-detail-shell.tsx` renders both).
 */
export function SourcesPanel({
  notebookId,
  sources,
  onCreated,
  onDeleted,
}: SourcesPanelProps) {
  const { sourceId, charStart, charEnd, openSource, closeSource } =
    useSourceReader()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deletingSource, setDeletingSource] =
    useState<SourceWithChunkCount | null>(null)

  const openSourceRow = sources.find((source) => source.id === sourceId)

  function handleDeleted(deletedId: string) {
    onDeleted(deletedId)
    if (sourceId === deletedId) closeSource()
  }

  if (openSourceRow) {
    return (
      <SourceReader
        source={openSourceRow}
        charStart={charStart}
        charEnd={charEnd}
        onBack={closeSource}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border p-3">
        <Button
          type="button"
          className="w-full rounded-full"
          onClick={() => setAddDialogOpen(true)}
          data-test="sources-add-button"
        >
          <Plus /> Quellen hinzufügen
        </Button>
      </div>

      {sources.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            Füge PDFs, Text oder Web-Seiten hinzu, um mit deinen eigenen
            Quellen zu arbeiten.
          </p>
          <Button
            type="button"
            className="rounded-full"
            onClick={() => setAddDialogOpen(true)}
            data-test="sources-empty-cta"
          >
            <Plus /> Quellen hinzufügen
          </Button>
        </div>
      ) : (
        <SourceList
          sources={sources}
          onOpen={(source) => openSource(source.id)}
          onDeleteRequest={setDeletingSource}
        />
      )}

      <AddSourceDialog
        notebookId={notebookId}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onCreated={onCreated}
      />

      <DeleteSourceDialog
        source={deletingSource}
        onOpenChange={(open) => !open && setDeletingSource(null)}
        onDeleted={handleDeleted}
      />
    </div>
  )
}
