"use client"

import {
  AlignLeft,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Globe,
  Hash,
  Loader2,
  RotateCw,
  Trash2,
} from "lucide-react"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  effectiveErrorMessage,
  effectiveStatus,
  type SourceStatus,
} from "@/lib/ingestion/source-status"

import { retrySourceAction } from "../actions"
import type { SourceWithChunkCount } from "../types"

/** One icon per `sources.type`. Distinguishing the formats at a glance
 *  matters more now that a notebook can hold seven of them — a single
 *  generic file icon for everything would make the list unscannable. */
const TYPE_ICON: Record<string, typeof FileText> = {
  pdf: FileText,
  txt: AlignLeft,
  md: Hash,
  docx: FileType,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  image: FileImage,
  text: AlignLeft,
  web: Globe,
}

/** One dot color per `sources.type` (app/globals.css `--source-*` tokens) —
 *  semantic, unlike `getNotebookCardColor`'s per-id hash used for notebook
 *  cards/rows. Same type always renders the same color, so two PDFs read as
 *  the same "kind" at a glance instead of arbitrary colors. */
const TYPE_DOT_COLOR: Record<string, string> = {
  pdf: "var(--source-pdf)",
  txt: "var(--source-text)",
  md: "var(--source-text)",
  docx: "var(--source-doc)",
  xlsx: "var(--source-sheet)",
  csv: "var(--source-sheet)",
  image: "var(--source-image)",
  text: "var(--source-text)",
  web: "var(--source-web)",
}

function StatusBadge({ status }: { status: SourceStatus }) {
  if (status === "ready") {
    return (
      <p
        className="mt-0.5 text-xs text-[var(--ok)]"
        data-test="source-status-badge"
      >
        Bereit
      </p>
    )
  }

  if (status === "error") {
    return (
      <p
        className="mt-0.5 text-xs font-medium text-[var(--danger)]"
        data-test="source-status-badge"
      >
        Fehler
      </p>
    )
  }

  return (
    <p
      className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"
      data-test="source-status-badge"
    >
      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      Wird verarbeitet…
    </p>
  )
}

interface SourceListItemProps {
  source: SourceWithChunkCount
  onOpen: () => void
  onDeleteRequest: () => void
}

export function SourceListItem({
  source,
  onOpen,
  onDeleteRequest,
}: SourceListItemProps) {
  const [retrying, startTransition] = useTransition()
  const Icon = TYPE_ICON[source.type] ?? FileText
  const status = effectiveStatus(source)
  const errorMessage = effectiveErrorMessage(source)
  const canOpen = status === "ready"

  function handleRetry(event: React.MouseEvent) {
    event.stopPropagation()
    startTransition(async () => {
      const result = await retrySourceAction({ sourceId: source.id })
      if ("error" in result) {
        toast.error(result.error)
      }
    })
  }

  function handleDelete(event: React.MouseEvent) {
    event.stopPropagation()
    onDeleteRequest()
  }

  return (
    <div
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? onOpen : undefined}
      onKeyDown={
        canOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onOpen()
              }
            }
          : undefined
      }
      className="flex items-start gap-2.5 rounded-[12px] p-2.5 hover:bg-background focus-visible:bg-background focus-visible:outline-none data-open:cursor-pointer"
      data-open={canOpen ? "" : undefined}
      data-test={`source-row-${source.id}`}
    >
      <span
        className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground"
        style={{
          backgroundColor: TYPE_DOT_COLOR[source.type] ?? "var(--source-text)",
        }}
        aria-hidden="true"
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] leading-[1.45] font-bold text-foreground">
          {source.title}
        </p>
        <StatusBadge status={status} />
        {status === "error" && errorMessage && (
          <p className="mt-0.5 text-xs text-[var(--danger)]">{errorMessage}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {status === "error" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleRetry}
            disabled={retrying}
            aria-label={`„${source.title}“ erneut verarbeiten`}
            data-test="source-retry-button"
          >
            <RotateCw />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          aria-label={`„${source.title}“ löschen`}
          data-test="source-delete-button"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}
