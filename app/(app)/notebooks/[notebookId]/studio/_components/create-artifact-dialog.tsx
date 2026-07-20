"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { REPORT_FORMAT_META, STUDIO_TYPE_META } from "@/lib/studio/format-meta"
import {
  REPORT_FORMAT_VALUES,
  type GeneratableType,
  type ReportFormat,
} from "@/lib/studio/schema"

import type { SourceWithChunkCount } from "../../sources/types"
import { SourcePicker } from "./source-picker"

export interface CreateArtifactRequest {
  type: GeneratableType
  format?: ReportFormat
  sourceIds: string[]
}

interface CreateArtifactDialogProps {
  /** Welche Kachel geklickt wurde — `null` = Dialog zu. */
  type: GeneratableType | null
  onOpenChange: (open: boolean) => void
  /** Ready-Quellen des Notebooks (Shell-State). */
  readySources: SourceWithChunkCount[]
  onCreate: (request: CreateArtifactRequest) => void
}

/**
 * Create-Dialog für alle Studio-Artefakte: Reports wählen zusätzlich eines
 * der 3 festen Formate, alle Typen wählen ihre Quellen (alle vorausgewählt
 * — User-Vorgabe: Quellen-Auswahl ja, sonst keine Feinjustierung).
 */
export function CreateArtifactDialog({
  type,
  onOpenChange,
  readySources,
  onCreate,
}: CreateArtifactDialogProps) {
  const [format, setFormat] = useState<ReportFormat>("briefing_doc")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Bei jedem Öffnen (Kachel-Klick) frisch: alle Quellen vorausgewählt,
  // Format zurück auf Default.
  useEffect(() => {
    if (type === null) return
    setSelectedIds(new Set(readySources.map((source) => source.id)))
    setFormat("briefing_doc")
    // `readySources` absichtlich nicht in den Deps: die Auswahl soll beim
    // ÖFFNEN einrasten, nicht bei jedem 2s-Poll-Refresh zurückspringen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const noSources = readySources.length === 0
  const meta = type ? STUDIO_TYPE_META[type] : null

  function toggleSource(sourceId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }
      return next
    })
  }

  function handleCreate() {
    if (!type) return
    onCreate({
      type,
      format: type === "report" ? format : undefined,
      sourceIds: [...selectedIds],
    })
  }

  return (
    <Dialog open={type !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-test="create-artifact-dialog">
        <DialogHeader>
          <DialogTitle>{meta ? `${meta.label} erstellen` : ""}</DialogTitle>
          <DialogDescription>
            {noSources
              ? "Füge zuerst eine Quelle hinzu und warte, bis sie verarbeitet ist."
              : "Wähle die Quellen, die verwendet werden sollen."}
          </DialogDescription>
        </DialogHeader>

        {type === "report" && !noSources && (
          <div className="grid gap-2 sm:grid-cols-3">
            {REPORT_FORMAT_VALUES.map((value) => {
              const formatMeta = REPORT_FORMAT_META[value]
              const active = format === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFormat(value)}
                  aria-pressed={active}
                  className={`flex flex-col items-start gap-1 rounded-xl p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    active
                      ? "bg-[var(--card-3)] ring-1 ring-[var(--action)]"
                      : "bg-[var(--surface-2)] hover:bg-border/60"
                  }`}
                  data-test={`create-report-format-${value}`}
                >
                  <span className="text-sm font-medium text-foreground">
                    {formatMeta.label}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {formatMeta.description}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {!noSources && (
          <SourcePicker
            sources={readySources}
            selectedIds={selectedIds}
            onToggle={toggleSource}
          />
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-test="create-artifact-cancel"
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={noSources || selectedIds.size === 0}
            data-test="create-artifact-submit"
          >
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
