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
import { Textarea } from "@/components/ui/textarea"
import {
  AUDIO_FORMAT_META,
  AUDIO_FORMAT_VALUES,
  AUDIO_LANGUAGES,
  AUDIO_LENGTH_META,
  AUDIO_LENGTH_VALUES,
  type AudioFormat,
  type AudioLength,
} from "@/lib/studio/audio-schema"
import { REPORT_FORMAT_META, STUDIO_TYPE_META } from "@/lib/studio/format-meta"
import {
  REPORT_FORMAT_VALUES,
  type GeneratableType,
  type ReportFormat,
} from "@/lib/studio/schema"

import type { SourceWithChunkCount } from "../../sources/types"
import { SourcePicker } from "./source-picker"

export type CreateArtifactRequest =
  | { type: "report"; format: ReportFormat; sourceIds: string[] }
  | { type: "flashcards" | "quiz"; sourceIds: string[] }
  | {
      type: "audio"
      format: AudioFormat
      language: string
      length: AudioLength
      focus?: string
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
 * Create-Dialog für alle Studio-Artefakte. Reports wählen eines der 3
 * Text-Formate; Audio (docs/specs/studio-audio.md, NotebookLM-Customize-
 * Parität) wählt Format/Sprache/Länge/Fokus; alle Typen wählen ihre Quellen
 * (alle vorausgewählt — sonst keine Feinjustierung, User-Vorgabe).
 */
export function CreateArtifactDialog({
  type,
  onOpenChange,
  readySources,
  onCreate,
}: CreateArtifactDialogProps) {
  const [format, setFormat] = useState<ReportFormat>("briefing_doc")
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("deep_dive")
  const [language, setLanguage] = useState<string>("de")
  const [length, setLength] = useState<AudioLength>("standard")
  const [focus, setFocus] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Bei jedem Öffnen (Kachel-Klick) frisch: alle Quellen vorausgewählt,
  // Optionen zurück auf Defaults.
  useEffect(() => {
    if (type === null) return
    setSelectedIds(new Set(readySources.map((source) => source.id)))
    setFormat("briefing_doc")
    setAudioFormat("deep_dive")
    setLanguage("de")
    setLength("standard")
    setFocus("")
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
    const sourceIds = [...selectedIds]
    if (type === "report") {
      onCreate({ type, format, sourceIds })
    } else if (type === "audio") {
      onCreate({
        type,
        format: audioFormat,
        language,
        length,
        focus: focus.trim() || undefined,
        sourceIds,
      })
    } else {
      onCreate({ type, sourceIds })
    }
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

        {type === "audio" && !noSources && (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {AUDIO_FORMAT_VALUES.map((value) => {
                const formatMeta = AUDIO_FORMAT_META[value]
                const active = audioFormat === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAudioFormat(value)}
                    aria-pressed={active}
                    className={`flex flex-col items-start gap-1 rounded-xl p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      active
                        ? "bg-[var(--card-4)] ring-1 ring-[var(--action)]"
                        : "bg-[var(--surface-2)] hover:bg-border/60"
                    }`}
                    data-test={`create-audio-format-${value}`}
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

            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Sprache
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  className="h-9 rounded-lg border border-border bg-[var(--surface)] px-2.5 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  data-test="create-audio-language"
                >
                  {AUDIO_LANGUAGES.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Länge
                <div className="flex overflow-hidden rounded-lg border border-border">
                  {AUDIO_LENGTH_VALUES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLength(value)}
                      aria-pressed={length === value}
                      className={`px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                        length === value
                          ? "bg-foreground text-background"
                          : "bg-[var(--surface)] text-foreground hover:bg-muted/40"
                      }`}
                      data-test={`create-audio-length-${value}`}
                    >
                      {AUDIO_LENGTH_META[value].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Worauf sollen die Hosts eingehen?
              <Textarea
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
                maxLength={500}
                rows={3}
                placeholder={
                  "Dinge zum Ausprobieren:\n• Eine bestimmte Quelle fokussieren\n• Ein bestimmtes Thema vertiefen\n• Für eine Zielgruppe erklären („erkläre es Einsteigern“)"
                }
                className="text-sm"
                data-test="create-audio-focus"
              />
            </label>
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
