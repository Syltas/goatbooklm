"use client"

import {
  AudioLines,
  FileText,
  HelpCircle,
  Loader2,
  MoreVertical,
  Pencil,
  RotateCw,
  Trash2,
  WalletCards,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { parseAudioContent, STALE_GENERATING_MINUTES_AUDIO } from "@/lib/studio/audio-schema"
import {
  parseFlashcardsContent,
  parseQuizContent,
} from "@/lib/studio/content-schema"
import { splitLeadingH1 } from "@/lib/studio/context"
import { REPORT_FORMAT_META, STUDIO_TYPE_META } from "@/lib/studio/format-meta"
import {
  GENERATABLE_TYPE_VALUES,
  type GeneratableType,
  type ReportFormat,
} from "@/lib/studio/schema"
import { STALE_GENERATING_MINUTES, type StudioArtifact } from "@/lib/studio/service"
import { createClient } from "@/lib/supabase/client"

import type { SourceWithChunkCount } from "../../sources/types"
import { AudioViewer } from "./audio-viewer"
import {
  CreateArtifactDialog,
  type CreateArtifactRequest,
} from "./create-artifact-dialog"
import { DeleteArtifactDialog } from "./delete-artifact-dialog"
import { FlashcardsViewer } from "./flashcards-viewer"
import { QuizViewer } from "./quiz-viewer"
import { RenameArtifactDialog } from "./rename-artifact-dialog"
import { ReportViewer } from "./report-viewer"

type ViewState =
  | { mode: "list" }
  | { mode: "viewer"; artifactId: string }
  | { mode: "live" }

interface LiveState {
  format: ReportFormat
  text: string
}

const TYPE_ICON: Record<GeneratableType, typeof FileText> = {
  report: FileText,
  flashcards: WalletCards,
  quiz: HelpCircle,
  audio: AudioLines,
}

/** Pastell-Kacheln gem. DESIGN.md (card-Paletten nur für Grid + Studio-Kacheln). */
const TYPE_TILE_BG: Record<GeneratableType, string> = {
  report: "bg-[var(--card-2)]",
  flashcards: "bg-[var(--card-5)]",
  quiz: "bg-[var(--card-6)]",
  audio: "bg-[var(--card-4)]",
}

/** Backstop (Spec): `generating` älter als das Stale-Fenster (updated_at)
 *  gilt als abgestürzt und wird als fehlgeschlagen angezeigt — Retry-fähig.
 *  Audio: 15 min (Jobs überspannen legal mehrere Worker-Ticks), sonst 5. */
function isStaleGenerating(artifact: StudioArtifact): boolean {
  const windowMinutes =
    artifact.type === "audio" ? STALE_GENERATING_MINUTES_AUDIO : STALE_GENERATING_MINUTES
  return (
    artifact.status === "generating" &&
    Date.now() - Date.parse(artifact.updated_at) > windowMinutes * 60_000
  )
}

/** Phasen-Text der generating-Row (Audio zeigt echten Fortschritt). */
function generatingLabel(artifact: StudioArtifact): string {
  if (artifact.type !== "audio") return "Wird erstellt…"
  const content = parseAudioContent(artifact.content)
  if (content?.phase === "tts" && content.tts) {
    return `Audio wird erzeugt… ${content.tts.done}/${content.tts.total}`
  }
  return "Skript wird geschrieben…"
}

function reportMarkdown(artifact: StudioArtifact): string {
  const content = artifact.content as { markdown?: string } | null
  return content?.markdown ?? ""
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" }).format(
    new Date(iso)
  )
}

interface StudioPanelProps {
  notebookId: string
  /** Live-gepollter Quellen-State des Shells — trägt Kachel-Disabling und
   *  die Quellen-Auswahl im Create-Dialog. */
  sources: SourceWithChunkCount[]
  /** Explain-Bridge: schickt einen vorbereiteten Prompt in den Chat. */
  onExplain?: (prompt: string) => void
  /**
   * Merge core-loop-v2: das Notes-Panel teilt sich den Studio-Slot mit den
   * Artefakten (NotebookLM-Layout — Kacheln/Artefakte oben, Notizen
   * darunter). Nur in der Listen-Ansicht gerendert; die Viewer nehmen den
   * vollen Slot.
   */
  notesSlot?: React.ReactNode
}

/**
 * Studio-Panel (docs/specs/studio-quick-wins.md): Kacheln für Bericht/
 * Karteikarten/Quiz + Artefakt-Liste + panel-interne Viewer. Lädt seine
 * Artefakte selbst über den Browser-Supabase-Client (RLS-scoped) — bewusst
 * KEIN `page.tsx`-Prop-Drilling, damit der Diff an Bestandsdateien beim
 * Panel-Body-Ersatz bleibt (Spec Premise 5).
 */
export function StudioPanel({
  notebookId,
  sources,
  onExplain,
  notesSlot,
}: StudioPanelProps) {
  const supabase = useMemo(() => createClient(), [])
  const [artifacts, setArtifacts] = useState<StudioArtifact[] | null>(null)
  const [view, setView] = useState<ViewState>({ mode: "list" })
  const [live, setLive] = useState<LiveState | null>(null)
  const [createType, setCreateType] = useState<GeneratableType | null>(null)
  const [renameTarget, setRenameTarget] = useState<StudioArtifact | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StudioArtifact | null>(null)
  /** Sobald DIESE Row nicht mehr `generating` ist (das `after()`-Persist der
   *  Route läuft der Response nach), in den persistierten Viewer wechseln. */
  const [pendingViewerId, setPendingViewerId] = useState<string | null>(null)
  /** Session-Zähler: „Zurück" während des Streams entwertet den laufenden
   *  fetch-Loop — die Generierung läuft server-seitig ohnehin zu Ende. */
  const streamSessionRef = useRef(0)

  const readySources = sources.filter((source) => source.status === "ready")

  const refetch = useCallback(async () => {
    const { data, error } = await supabase
      .from("studio_artifacts")
      .select()
      .eq("notebook_id", notebookId)
      .order("created_at", { ascending: false })
    if (!error) setArtifacts(data ?? [])
  }, [supabase, notebookId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  // Solange irgendeine Row (frisch) generiert oder ein Viewer-Wechsel
  // aussteht, alle 2s nachladen — deckt auch das after()-Persist-Lag ab.
  const polling =
    pendingViewerId !== null ||
    (artifacts ?? []).some(
      (artifact) => artifact.status === "generating" && !isStaleGenerating(artifact)
    )
  useEffect(() => {
    if (!polling) return
    const id = setInterval(() => void refetch(), 2000)
    return () => clearInterval(id)
  }, [polling, refetch])

  useEffect(() => {
    if (!pendingViewerId || !artifacts) return
    const row = artifacts.find((artifact) => artifact.id === pendingViewerId)
    if (!row || row.status === "generating") return
    setPendingViewerId(null)
    setLive(null)
    if (row.status === "ready") {
      setView({ mode: "viewer", artifactId: row.id })
    } else {
      setView({ mode: "list" })
      toast.error(row.error_message ?? "Artefakt konnte nicht erstellt werden.")
    }
  }, [artifacts, pendingViewerId])

  /** Reports: Text-Stream in den Live-Viewer. */
  async function startReportStream(
    body: Record<string, unknown>,
    liveFormat: ReportFormat
  ) {
    const session = ++streamSessionRef.current
    setCreateType(null)
    setPendingViewerId(null)
    setLive({ format: liveFormat, text: "" })
    setView({ mode: "live" })

    try {
      const response = await fetch("/api/studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId, ...body }),
      })
      if (!response.ok || !response.body) {
        const message = await response.text().catch(() => "")
        throw new Error(message || "Bericht konnte nicht erstellt werden.")
      }
      const artifactId = response.headers.get("X-Artifact-Id")
      void refetch()

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (streamSessionRef.current !== session) {
          void reader.cancel().catch(() => undefined)
          return
        }
        const chunk = decoder.decode(value, { stream: true })
        setLive((prev) => (prev ? { ...prev, text: prev.text + chunk } : prev))
      }

      if (streamSessionRef.current !== session) return
      if (artifactId) {
        setPendingViewerId(artifactId)
      } else {
        setLive(null)
        setView({ mode: "list" })
      }
      void refetch()
    } catch (error) {
      if (streamSessionRef.current !== session) return
      toast.error(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Bericht konnte nicht erstellt werden."
      )
      setLive(null)
      setView({ mode: "list" })
      void refetch()
    }
  }

  /** Flashcards/Quiz: 202 + Artefakt-ID sofort, Row generiert im
   *  Hintergrund — Liste zeigt die Skeleton-Row, `pendingViewerId` öffnet
   *  den Viewer, sobald sie `ready` ist. */
  async function startObjectGeneration(body: Record<string, unknown>) {
    setCreateType(null)
    try {
      const response = await fetch("/api/studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId, ...body }),
      })
      if (!response.ok) {
        const message = await response.text().catch(() => "")
        throw new Error(message || "Artefakt konnte nicht erstellt werden.")
      }
      const { artifactId } = (await response.json()) as { artifactId: string }
      setPendingViewerId(artifactId)
      setView({ mode: "list" })
      void refetch()
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Artefakt konnte nicht erstellt werden."
      )
      void refetch()
    }
  }

  function handleCreate(request: CreateArtifactRequest) {
    if (request.type === "report") {
      void startReportStream({ ...request }, request.format)
    } else {
      // Flashcards/Quiz (inline 202) und Audio (Queue 202) teilen den Pfad:
      // Response trägt die Artefakt-ID, der Panel-Poll übernimmt.
      void startObjectGeneration({ ...request })
    }
  }

  function handleRetry(artifact: StudioArtifact) {
    if (artifact.type === "report") {
      void startReportStream(
        { retryArtifactId: artifact.id },
        (artifact.format ?? "briefing_doc") as ReportFormat
      )
    } else {
      void startObjectGeneration({ retryArtifactId: artifact.id })
    }
  }

  function leaveLiveView() {
    streamSessionRef.current += 1
    setPendingViewerId(null)
    setLive(null)
    setView({ mode: "list" })
    void refetch()
  }

  function handleRenamed(artifact: StudioArtifact) {
    setArtifacts((prev) =>
      prev ? prev.map((row) => (row.id === artifact.id ? artifact : row)) : prev
    )
  }

  function handleDeleted(artifactId: string) {
    setArtifacts((prev) =>
      prev ? prev.filter((row) => row.id !== artifactId) : prev
    )
    if (view.mode === "viewer" && view.artifactId === artifactId) {
      setView({ mode: "list" })
    }
  }

  function artifactMenu(artifact: StudioArtifact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={(event) => event.stopPropagation()}
            aria-label={`Optionen für „${artifact.title}“`}
            data-test={`artifact-menu-${artifact.id}`}
          >
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            data-test="artifact-menu-rename"
            onSelect={() => setRenameTarget(artifact)}
          >
            <Pencil /> Umbenennen
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            data-test="artifact-menu-delete"
            onSelect={() => setDeleteTarget(artifact)}
          >
            <Trash2 /> Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const sharedDialogs = (
    <>
      <RenameArtifactDialog
        artifact={renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        onRenamed={handleRenamed}
      />
      <DeleteArtifactDialog
        artifact={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDeleted={handleDeleted}
      />
    </>
  )

  // --- Viewer-Modi -------------------------------------------------------

  if (view.mode === "live" && live) {
    const { title, body } = splitLeadingH1(live.text)
    return (
      <ReportViewer
        title={title ?? REPORT_FORMAT_META[live.format].label}
        markdown={body}
        streaming
        onBack={leaveLiveView}
      />
    )
  }

  if (view.mode === "viewer") {
    const artifact = artifacts?.find((row) => row.id === view.artifactId)
    if (artifact) {
      const onBack = () => setView({ mode: "list" })
      const menu = artifactMenu(artifact)

      let viewer: React.ReactNode = null
      if (artifact.type === "report") {
        viewer = (
          <ReportViewer
            title={artifact.title}
            markdown={reportMarkdown(artifact)}
            streaming={false}
            onBack={onBack}
            menu={menu}
          />
        )
      } else if (artifact.type === "flashcards") {
        const content = parseFlashcardsContent(artifact.content)
        viewer = content ? (
          <FlashcardsViewer
            title={artifact.title}
            cards={content.cards}
            onBack={onBack}
            menu={menu}
            onExplain={onExplain}
          />
        ) : null
      } else if (artifact.type === "quiz") {
        const content = parseQuizContent(artifact.content)
        viewer = content ? (
          <QuizViewer
            title={artifact.title}
            questions={content.questions}
            onBack={onBack}
            menu={menu}
            onExplain={onExplain}
          />
        ) : null
      } else if (artifact.type === "audio") {
        const content = parseAudioContent(artifact.content)
        viewer =
          content?.storage_path && content.script ? (
            <AudioViewer
              title={artifact.title}
              storagePath={content.storage_path}
              script={content.script}
              onBack={onBack}
              menu={menu}
            />
          ) : null
      }

      if (viewer === null) {
        // Kaputtes/unbekanntes content-Shape: nicht crashen, zurück zur
        // Liste mit Hinweis.
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              Dieses Artefakt kann nicht angezeigt werden.
            </p>
            <Button type="button" variant="outline" onClick={onBack} data-test="viewer-broken-back">
              Zurück zum Studio
            </Button>
          </div>
        )
      }

      return (
        <>
          {viewer}
          {sharedDialogs}
        </>
      )
    }
  }

  // --- Liste -------------------------------------------------------------

  return (
    <div className="flex h-full flex-col" data-test="studio-panel">
      <div className="grid shrink-0 grid-cols-2 gap-2 p-3">
        {GENERATABLE_TYPE_VALUES.map((type) => {
          const Icon = TYPE_ICON[type]
          return (
            <button
              key={type}
              type="button"
              onClick={() => setCreateType(type)}
              className={`flex flex-col items-center gap-1.5 rounded-xl p-3 text-center transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${TYPE_TILE_BG[type]}`}
              data-test={`studio-create-${type}-tile`}
            >
              <Icon className="size-4 text-foreground" aria-hidden="true" />
              <span className="text-xs font-medium text-foreground">
                {STUDIO_TYPE_META[type].label}
              </span>
            </button>
          )
        })}
      </div>

      <div
        className={`min-h-0 overflow-y-auto ${notesSlot ? "flex-[2]" : "flex-1"}`}
        data-test="studio-artifact-list"
      >
        {artifacts === null ? (
          <div className="space-y-2 px-3 py-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : artifacts.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Noch keine Artefakte. Erstelle das erste aus deinen Quellen.
          </p>
        ) : (
          artifacts.map((artifact) => {
            const failed = artifact.status === "failed" || isStaleGenerating(artifact)
            const generating = artifact.status === "generating" && !failed
            const canOpen = artifact.status === "ready"
            const Icon = TYPE_ICON[artifact.type as GeneratableType] ?? FileText
            return (
              <div
                key={artifact.id}
                role={canOpen ? "button" : undefined}
                tabIndex={canOpen ? 0 : undefined}
                onClick={
                  canOpen
                    ? () => setView({ mode: "viewer", artifactId: artifact.id })
                    : undefined
                }
                onKeyDown={
                  canOpen
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          setView({ mode: "viewer", artifactId: artifact.id })
                        }
                      }
                    : undefined
                }
                className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none data-open:cursor-pointer"
                data-open={canOpen ? "" : undefined}
                data-test={`artifact-row-${artifact.id}`}
              >
                <Icon
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {artifact.title}
                  </p>
                  {generating ? (
                    <p
                      className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"
                      data-test="artifact-status-badge"
                    >
                      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                      {generatingLabel(artifact)}
                    </p>
                  ) : failed ? (
                    <p
                      className="mt-0.5 text-xs font-medium text-[var(--danger)]"
                      data-test="artifact-status-badge"
                    >
                      Fehler
                    </p>
                  ) : (
                    <p
                      className="mt-0.5 text-xs text-muted-foreground"
                      data-test="artifact-status-badge"
                    >
                      {formatDate(artifact.created_at)}
                    </p>
                  )}
                </div>
                <div
                  className="flex shrink-0 items-center gap-0.5"
                  onClick={(event) => event.stopPropagation()}
                >
                  {failed && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRetry(artifact)}
                      aria-label={`„${artifact.title}“ erneut erstellen`}
                      data-test="artifact-retry-button"
                    >
                      <RotateCw />
                    </Button>
                  )}
                  {!generating && artifactMenu(artifact)}
                </div>
              </div>
            )
          })
        )}
      </div>

      {notesSlot && (
        <div
          className="min-h-0 flex-[3] overflow-hidden border-t border-border"
          data-test="studio-notes-slot"
        >
          {notesSlot}
        </div>
      )}

      <CreateArtifactDialog
        type={createType}
        onOpenChange={(open) => !open && setCreateType(null)}
        readySources={readySources}
        onCreate={handleCreate}
      />
      {sharedDialogs}
    </div>
  )
}
