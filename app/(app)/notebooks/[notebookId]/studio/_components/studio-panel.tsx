"use client"

import {
  ArrowLeft,
  AudioLines,
  FileText,
  HelpCircle,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
  WalletCards,
} from "lucide-react"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { toast } from "sonner"

import type { OnCiteArgs } from "@/components/chat/citation-chip"
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
import { STUDIO_TYPE_META } from "@/lib/studio/format-meta"
import {
  GENERATABLE_TYPE_VALUES,
  type GeneratableType,
} from "@/lib/studio/schema"
import { STALE_GENERATING_MINUTES, type StudioArtifact } from "@/lib/studio/service"
import type { Note } from "@/lib/notes/service"
import { createClient } from "@/lib/supabase/client"

import { useSourceReader } from "../../_components/source-reader-context"
import { createNoteAction } from "../../notes/actions"
import { DeleteNoteDialog } from "../../notes/_components/delete-note-dialog"
import { NoteEditor, type NoteEditorHandle } from "../../notes/_components/note-editor"
import { NoteListItem } from "../../notes/_components/note-list-item"
import { NoteViewer } from "../../notes/_components/note-viewer"
import { RenameNoteDialog } from "../../notes/_components/rename-note-dialog"
import type { SourceWithChunkCount } from "../../sources/types"
import { AudioViewer } from "./audio-viewer"
import {
  CreateArtifactDialog,
  type CreateArtifactRequest,
} from "./create-artifact-dialog"
import { DeleteArtifactDialog } from "./delete-artifact-dialog"
import { FlashcardsViewer } from "./flashcards-viewer"
import { FullscreenContainer } from "./fullscreen-container"
import { QuizViewer } from "./quiz-viewer"
import { RenameArtifactDialog } from "./rename-artifact-dialog"
import { ReportViewer } from "./report-viewer"

type ViewState =
  | { mode: "list" }
  | { mode: "viewer"; artifactId: string }
  | { mode: "note"; noteId: string }

/**
 * One combined list entry — Notizen und Artefakte teilen sich EINEN Strom
 * (DoD 1). `sort` ist `updated_at` (fallback `created_at`), damit die Liste
 * gemischt nach letzter Änderung absteigend sortiert.
 */
type StudioEntry =
  | { kind: "artifact"; sort: number; artifact: StudioArtifact }
  | { kind: "note"; sort: number; note: Note }

function entrySort(updatedAt: string, createdAt: string): number {
  return Date.parse(updatedAt || createdAt)
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
   * Notizen teilen sich EINE Liste mit den Artefakten (DoD 1) — die Daten
   * sind (wie `sources`) in `notebook-detail-shell.tsx` über beide Mounts
   * (Desktop + Mobile-Sheet) geliftet, damit sie mount-übergreifend
   * konsistent bleiben (Bugfix Befund 6, siehe `use-notes-state.ts`).
   */
  notes: Note[]
  onNoteCreated: (note: Note) => void
  onNoteUpdated: (note: Note) => void
  onNoteDeleted: (id: string) => void
  /** Mobile-only: a citation chip inside a read-only chat note jumps to the
   *  source reader, which on mobile lives behind the bottom sheet — this
   *  swaps the studio sheet for the sources sheet so the jump is visible.
   *  Same signal the chat's `onMobileReaderOpen` uses (`ChatPanelSlot`). A
   *  no-op on desktop (guarded by `matchMedia` at click time in `handleNoteCite`). */
  onMobileReaderOpen: () => void
}

/** Bugfix Befund 6 (übernommen von `NotesPanel`) — lässt
 *  `notebook-detail-shell.tsx` den ausstehenden Autosave der aktuell
 *  offenen Notiz erzwingen, bevor der Mobile-Studio-Sheet-Mount unmountet.
 *  No-op (resolved sofort), solange kein Notiz-Viewer offen ist. */
export interface StudioPanelHandle {
  flush: () => Promise<void>
  /** Verlässt das interne Fullscreen-Overlay (#6) des offenen Viewers/Note —
   *  No-op, wenn gerade nicht im Fullscreen. Der Shell braucht das, um beim
   *  „Erklären" das `fixed inset-0`-Overlay abzuräumen, damit der Chat
   *  dahinter sichtbar wird (die Fullscreen-State liegt panel-intern). */
  exitFullscreen: () => void
}

/**
 * Studio-Panel (docs/specs/studio-quick-wins.md): Kacheln für Bericht/
 * Karteikarten/Quiz + EINE gemeinsame Liste aus Artefakten UND Notizen +
 * panel-interne Viewer (Artefakt-Viewer und der Notiz-`NoteEditor` als
 * Full-Column-Viewer, über denselben `view`-State geöffnet — es gibt nur
 * EINE Öffnen-Mechanik). Lädt seine Artefakte selbst über den Browser-
 * Supabase-Client (RLS-scoped); die Notizen kommen als Prop vom Shell.
 */
export const StudioPanel = forwardRef<StudioPanelHandle, StudioPanelProps>(function StudioPanel(
  {
    notebookId,
    sources,
    onExplain,
    notes,
    onNoteCreated,
    onNoteUpdated,
    onNoteDeleted,
    onMobileReaderOpen,
  },
  ref
) {
  // Valid here because every `StudioPanel` mount lives inside the shell's
  // `SourceReaderProvider` (`notebook-detail-shell.tsx`) — the same provider
  // the chat's `onCite` flips. A read-only chat note's citation chips use it.
  const { openSource } = useSourceReader()
  const supabase = useMemo(() => createClient(), [])
  const [artifacts, setArtifacts] = useState<StudioArtifact[] | null>(null)
  const [view, setView] = useState<ViewState>({ mode: "list" })
  /** Fullscreen-Overlay (#6) für den gerade offenen Viewer/NoteEditor — siehe
   *  `FullscreenContainer`. Gilt nur für `viewer`/`note`; jeder andere
   *  `view`-Wechsel (zurück zur Liste, ein ANDERES Artefakt/Notiz öffnen)
   *  setzt ihn unten per Effekt zurück, damit er nie „hängen" bleibt. */
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [createType, setCreateType] = useState<GeneratableType | null>(null)
  const [renameTarget, setRenameTarget] = useState<StudioArtifact | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StudioArtifact | null>(null)
  const [renamingNote, setRenamingNote] = useState<Note | null>(null)
  const [deletingNote, setDeletingNote] = useState<Note | null>(null)
  const [creatingNote, startNoteTransition] = useTransition()
  /** Imperativer Griff auf den aktuell offenen `NoteEditor` (nur im
   *  `note`-Viewer gemountet) — treibt `flush()` unten. */
  const noteEditorRef = useRef<NoteEditorHandle>(null)
  /** Sobald DIESE Row nicht mehr `generating` ist (das `after()`-Persist der
   *  Route läuft der Response nach), in den persistierten Viewer wechseln. */
  const [pendingViewerId, setPendingViewerId] = useState<string | null>(null)

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
    // Nur automatisch in den Viewer wechseln, wenn der Nutzer noch auf der
    // Liste ist — sonst NICHT den gerade offenen `NoteEditor`/Viewer
    // verdrängen (`setView` würde ihn unmounten, ohne den ausstehenden
    // Autosave zu flushen, siehe `use-note-autosave.ts`: bis zu ~800ms
    // ungespeicherte Edits gingen sonst verloren). Das Artefakt steht
    // trotzdem als `ready`/`Fehler` in der Liste, sobald der Nutzer
    // dorthin zurückkehrt.
    if (row.status === "ready") {
      if (view.mode === "list") {
        setView({ mode: "viewer", artifactId: row.id })
      }
    } else {
      if (view.mode === "list") {
        setView({ mode: "list" })
      }
      toast.error(row.error_message ?? "Artefakt konnte nicht erstellt werden.")
    }
  }, [artifacts, pendingViewerId, view.mode])

  // Fullscreen-Reset (#6, DoD 4): identifiziert den gerade offenen
  // Viewer/Note eindeutig (Typ + ID statt nur `view.mode`, falls ein
  // späterer Umbau je direkt von einem Artefakt/einer Notiz zum nächsten
  // wechselt, ohne über die Liste zu gehen) — jeder Wechsel des Keys
  // (inkl. „kein Viewer mehr offen") setzt Fullscreen zurück. Der Toggle
  // selbst ändert `view` nicht, läuft also nicht in diesen Effekt.
  const openContentKey =
    view.mode === "viewer"
      ? `viewer:${view.artifactId}`
      : view.mode === "note"
        ? `note:${view.noteId}`
        : null
  useEffect(() => {
    setIsFullscreen(false)
  }, [openContentKey])

  /** Einheitlicher Hintergrund-Pfad für ALLE Typen (report/flashcards/quiz/
   *  audio): die Response trägt die Artefakt-ID (Header `X-Artifact-Id`), die
   *  Liste zeigt die generating-Row, `pendingViewerId` öffnet den Viewer,
   *  sobald sie `ready` ist. KEIN Live-View mehr — Reports antworten zwar als
   *  Text-Stream, aber der Server konsumiert ihn selbst (`consumeStream()`)
   *  und persistiert in `after()`, unabhängig vom Client (wie beim Chat). Wir
   *  zeigen den Stream also nicht an und geben den ungelesenen Body frei;
   *  Flashcards/Quiz/Audio liefern stattdessen ein 202-JSON — beide Wege
   *  tragen die ID im selben Header. */
  async function startGeneration(body: Record<string, unknown>) {
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
      const artifactId = response.headers.get("X-Artifact-Id")
      // Report-Stream (oder das kleine 202-JSON) wird nicht gelesen — die
      // Persistenz sitzt server-seitig. Ungelesenen Body freigeben, statt ihn
      // offen zu lassen; das entspricht dem „Tab zu"-Fall, den die Route
      // ohnehin abdeckt.
      void response.body?.cancel().catch(() => undefined)
      if (!artifactId) {
        throw new Error("Artefakt konnte nicht erstellt werden.")
      }
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
    // Alle Typen teilen jetzt EINEN Pfad — auch der Report generiert im
    // Hintergrund (kein erzwungener Live-View mehr); der Panel-Poll übernimmt.
    void startGeneration({ ...request })
  }

  function handleRetry(artifact: StudioArtifact) {
    // Retry ist für alle Typen identisch: die Route liest Typ/Format aus dem
    // bestehenden Artefakt (`retryArtifactId`) selbst.
    void startGeneration({ retryArtifactId: artifact.id })
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

  // --- Notizen -----------------------------------------------------------

  // Mobile-Sheet-Flush (Bugfix Befund 6): delegiert an den offenen
  // `NoteEditor`; kein offener Notiz-Viewer → `noteEditorRef.current` ist
  // null → resolved sofort.
  useImperativeHandle(
    ref,
    () => ({
      flush: () => noteEditorRef.current?.flush() ?? Promise.resolve(),
      exitFullscreen: () => setIsFullscreen(false),
    }),
    []
  )

  // Read-only chat-note citation jump — identical to `ChatPanelSlot`'s
  // `handleCite`: flip the shared source reader, and on a mobile viewport also
  // swap this studio sheet for the sources sheet so the jump is actually
  // visible. `matchMedia` is checked at click time (not a hook) so a desktop
  // click never opens the mobile sheet just because the window was once narrow.
  function handleNoteCite({ sourceId, charStart, charEnd, sourceTitle }: OnCiteArgs) {
    openSource(sourceId, { charStart, charEnd, sourceTitle })
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      onMobileReaderOpen()
    }
  }

  // Bugfix (Datenverlust): vor dem manuellen Zurück-Navigieren den
  // ausstehenden Autosave des offenen `NoteEditor` flushen — sonst
  // unmountet `setView` ihn mitten im Debounce-Fenster und wirft bis zu
  // ~800ms ungespeicherte Edits weg. Spiegelt den Mobile-Sheet-Close-Pfad
  // (`StudioPanelHandle.flush`), der dasselbe bereits tut.
  async function handleNoteBack() {
    await noteEditorRef.current?.flush()
    setView({ mode: "list" })
  }

  function handleCreateNote() {
    startNoteTransition(async () => {
      const result = await createNoteAction({ notebookId })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      onNoteCreated(result.data)
      // #1: die neue Notiz sofort im Editor öffnen (dieselbe Öffnen-Mechanik
      // wie ein Klick auf eine Listen-Notiz) — Klick auf den FAB erstellt UND
      // öffnet. Die Notiz landet über `onNoteCreated` im gelifteten `notes`-
      // Prop, sodass der `note`-Viewer-Branch sie unten findet.
      setView({ mode: "note", noteId: result.data.id })
    })
  }

  function handleNoteDeleted(id: string) {
    onNoteDeleted(id)
    setDeletingNote((current) => (current?.id === id ? null : current))
    // Eine Notiz kann direkt aus der Listenzeile gelöscht werden, während sie
    // zugleich die offene ist — dann zurück zur Liste statt den Viewer auf
    // eine nicht mehr existente Notiz gemountet zu lassen.
    if (view.mode === "note" && view.noteId === id) {
      setView({ mode: "list" })
    }
  }

  // Notizen + Artefakte als EIN gemischter Strom, absteigend nach
  // `updated_at` (fallback `created_at`). Solange die Artefakte noch laden
  // (`artifacts === null`) tauchen die bereits vorhandenen Notizen sofort
  // auf; die Artefakte reihen sich beim Nachladen ein.
  const entries = useMemo<StudioEntry[]>(() => {
    const artifactEntries: StudioEntry[] = (artifacts ?? []).map((artifact) => ({
      kind: "artifact",
      sort: entrySort(artifact.updated_at, artifact.created_at),
      artifact,
    }))
    const noteEntries: StudioEntry[] = notes.map((note) => ({
      kind: "note",
      sort: entrySort(note.updated_at, note.created_at),
      note,
    }))
    return [...artifactEntries, ...noteEntries].sort((a, b) => b.sort - a.sort)
  }, [artifacts, notes])

  function renderArtifactRow(artifact: StudioArtifact) {
    const failed = artifact.status === "failed" || isStaleGenerating(artifact)
    const generating = artifact.status === "generating" && !failed
    const canOpen = artifact.status === "ready"
    const Icon = TYPE_ICON[artifact.type as GeneratableType] ?? FileText
    return (
      <div
        key={`artifact-${artifact.id}`}
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
          <FullscreenContainer
            isFullscreen={isFullscreen}
            onToggle={() => setIsFullscreen((value) => !value)}
          >
            {viewer}
          </FullscreenContainer>
          {sharedDialogs}
        </>
      )
    }
  }

  // Notiz-Viewer: der `NoteEditor` ersetzt — wie die Artefakt-Viewer — die
  // Liste und nimmt die VOLLE Spaltenhöhe ein (DoD 2). Geöffnet über
  // denselben `view`-State (eine einzige Öffnen-Mechanik). `key={note.id}`
  // erzwingt beim Wechsel zwischen zwei Notizen einen echten Remount, weil
  // `useEditor`s `content` nur beim Mount gelesen wird (siehe `NoteEditor`).
  if (view.mode === "note") {
    const note = notes.find((row) => row.id === view.noteId)
    if (note) {
      return (
        <FullscreenContainer
          isFullscreen={isFullscreen}
          onToggle={() => setIsFullscreen((value) => !value)}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-11 shrink-0 items-center border-b border-border px-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void handleNoteBack()}
                aria-label="Zurück zur Notizliste"
                data-test="notes-back-button"
              >
                <ArrowLeft className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              {/* A chat-origin note (`origin === 'chat'`) is a captured chat
                  answer/summary: render it read-only with the chat's exact
                  markdown + citation-chip stack (`NoteViewer`), not the TipTap
                  editor. A hand-authored note keeps the editor. The read-only
                  viewer has no autosave, so `noteEditorRef` stays unattached and
                  the mobile-sheet `flush()` (see `StudioPanelHandle`) resolves
                  to a no-op for it — which is correct, there's nothing to
                  flush. */}
              {note.origin === "chat" ? (
                <NoteViewer
                  key={note.id}
                  note={note}
                  onCite={handleNoteCite}
                  onUpdated={onNoteUpdated}
                />
              ) : (
                <NoteEditor
                  ref={noteEditorRef}
                  key={note.id}
                  note={note}
                  onUpdated={onNoteUpdated}
                />
              )}
            </div>
          </div>
        </FullscreenContainer>
      )
    }
    // Notiz nicht (mehr) vorhanden — durchfallen zur Liste.
  }

  // --- Liste -------------------------------------------------------------

  return (
    <div className="relative flex h-full flex-col" data-test="studio-panel">
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

      {/* EINE gemeinsame Liste (DoD 1): Artefakte + Notizen gemischt nach
          `updated_at` (fallback `created_at`). `pb-20` reserviert Platz, damit
          der FAB unten die letzte Zeile nicht überdeckt. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto pb-20"
        data-test="studio-artifact-list"
      >
        {artifacts === null && notes.length === 0 ? (
          <div className="space-y-2 px-3 py-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Noch keine Artefakte oder Notizen. Erstelle das erste aus deinen
            Quellen oder füge eine Notiz hinzu.
          </p>
        ) : (
          entries.map((entry) =>
            entry.kind === "artifact" ? (
              renderArtifactRow(entry.artifact)
            ) : (
              <NoteListItem
                key={`note-${entry.note.id}`}
                note={entry.note}
                onOpen={(note) => setView({ mode: "note", noteId: note.id })}
                onRenameRequest={setRenamingNote}
                onDeleteRequest={setDeletingNote}
              />
            )
          )
        )}
      </div>

      {/* Floating Action Button (DoD 3): absolut über dem Studio-Inhalt,
          belegt keinen Layout-Platz, immer sichtbar in der Liste — ersetzt
          den alten Full-Width-Button UND die Empty-State-CTA. */}
      <Button
        type="button"
        variant="outline"
        onClick={handleCreateNote}
        disabled={creatingNote}
        className="absolute right-4 bottom-4 z-10 h-[38px] rounded-full border-border bg-card px-4 text-[14px] font-bold text-foreground shadow-lg hover:bg-secondary"
        data-test="notes-add-button"
      >
        <Plus className="size-[15px]" /> Notiz hinzufügen
      </Button>

      <CreateArtifactDialog
        type={createType}
        onOpenChange={(open) => !open && setCreateType(null)}
        readySources={readySources}
        onCreate={handleCreate}
      />
      <RenameNoteDialog
        note={renamingNote}
        onOpenChange={(open) => !open && setRenamingNote(null)}
        onRenamed={onNoteUpdated}
      />
      <DeleteNoteDialog
        note={deletingNote}
        onOpenChange={(open) => !open && setDeletingNote(null)}
        onDeleted={handleNoteDeleted}
      />
      {sharedDialogs}
    </div>
  )
})
