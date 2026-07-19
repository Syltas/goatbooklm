"use client"

import { AlignLeft, FileText, Globe, Loader2, RotateCw, Trash2 } from "lucide-react"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  effectiveErrorMessage,
  effectiveStatus,
  type SourceStatus,
} from "@/lib/ingestion/source-status"

import { retrySourceAction } from "../actions"
import { getChunkCount, type SourceWithChunkCount } from "../types"

const TYPE_ICON: Record<string, typeof FileText> = {
  pdf: FileText,
  text: AlignLeft,
  web: Globe,
}

function StatusBadge({
  status,
  chunkCount,
}: {
  status: SourceStatus
  chunkCount: number
}) {
  if (status === "ready") {
    return (
      <p
        className="mt-0.5 text-xs text-[var(--ok)]"
        data-test="source-status-badge"
      >
        Bereit · {chunkCount} {chunkCount === 1 ? "Chunk" : "Chunks"}
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
      className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none data-open:cursor-pointer"
      data-open={canOpen ? "" : undefined}
      data-test={`source-row-${source.id}`}
    >
      <Icon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {source.title}
        </p>
        <StatusBadge status={status} chunkCount={getChunkCount(source)} />
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
