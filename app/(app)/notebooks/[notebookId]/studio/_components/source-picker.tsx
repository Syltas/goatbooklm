"use client"

import type { SourceWithChunkCount } from "../../sources/types"

interface SourcePickerProps {
  /** Ready-Quellen des Notebooks (Shell-State, live gepollt). */
  sources: SourceWithChunkCount[]
  selectedIds: Set<string>
  onToggle: (sourceId: string) => void
}

/**
 * Quellen-Auswahl im Create-Dialog (User-Vorgabe 2026-07-20: "man sollte
 * wählen können welche sources verwendet werden"). Bewusst IM Dialog statt
 * als globale Checkboxen im Sources-Panel — das Sources-Panel wird parallel
 * von der core-loop-v2-Session umgebaut (Merge-Konfliktfläche), und die
 * Generate-Route nimmt `sourceIds` ohnehin schon entgegen. Alle Quellen
 * starten vorausgewählt; native Checkboxen, kein Extra-Dependency.
 */
export function SourcePicker({ sources, selectedIds, onToggle }: SourcePickerProps) {
  if (sources.length === 0) return null

  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
      {sources.map((source) => (
        <label
          key={source.id}
          className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40"
        >
          <input
            type="checkbox"
            checked={selectedIds.has(source.id)}
            onChange={() => onToggle(source.id)}
            className="size-4 shrink-0 accent-[var(--action)]"
            data-test={`source-picker-checkbox-${source.id}`}
          />
          <span className="min-w-0 flex-1 truncate text-foreground">{source.title}</span>
        </label>
      ))}
    </div>
  )
}
