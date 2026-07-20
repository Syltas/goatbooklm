"use client"

import { Loader2, Upload, X } from "lucide-react"
import { useRef, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ACCEPT_ATTRIBUTE,
  FILE_FORMATS,
  detectFileFormat,
  formatByteLimit,
  stripKnownExtension,
} from "@/lib/ingestion/formats"
import { sha256Hex } from "@/lib/ingestion/hash"
import { INGESTION_MESSAGES } from "@/lib/ingestion/messages"
import { createClient as createBrowserClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

import { createFileSourceAction, processSourceAction } from "../actions"

const SOURCES_BUCKET = "sources"

interface FileUploadTabProps {
  notebookId: string
  /** Called once every selected file has fully succeeded (create → upload →
   *  enqueue). No source row is passed back — unlike Text/Web,
   *  `createFileSourceAction` only returns `{ sourceId, storagePath }` (§9
   *  contract) per file, not a full row — new pending sources show up via
   *  the automatic Next.js router refresh that follows a Server Action
   *  calling `revalidatePath` (both `createFileSourceAction` and
   *  `processSourceAction` do, once per file). If any file failed, the
   *  dialog stays open so its per-file error stays visible (task 4) instead
   *  of silently closing on a partial success. */
  onDone: () => void
}

type FileStatus = "idle" | "uploading" | "done" | "error"

interface SelectedFile {
  id: string
  file: File
  status: FileStatus
  error: string | null
  // AC-11-style retry-in-place, generalized to N files: once
  // `createFileSourceAction` has created a row for this file, remember it —
  // a later Storage-upload or enqueue failure retries steps (b)+(c) against
  // this SAME row instead of calling `createFileSourceAction` again, which
  // would (a) create a duplicate row and (b) get rejected outright by the
  // content-hash dedupe constraint against the row this same retry already
  // created.
  pendingUpload: { sourceId: string; storagePath: string } | null
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function toSelectedFiles(files: File[]): SelectedFile[] {
  return files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    status: "idle",
    error: null,
    pendingUpload: null,
  }))
}

export function FileUploadTab({ notebookId, onDone }: FileUploadTabProps) {
  const [selected, setSelected] = useState<SelectedFile[]>([])
  const [title, setTitle] = useState("")
  // Bug fix (real incident — see task brief): the title used to be derived
  // via `prev || stripKnownExtension(candidate.name)`, which stuck across a
  // file SWITCH within the same open dialog. Picking file A filled the
  // title; picking file B afterwards left the title on "A" while the bytes
  // underneath were already B's — that mismatch is exactly what produced
  // two sources with swapped titles/content. `titleTouched` tracks whether
  // the user has edited the field BY HAND; as long as they haven't, the
  // title keeps following whatever file is currently selected — once they
  // have, their text is never overwritten again by a later file pick.
  const [titleTouched, setTitleTouched] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [pending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Task 2: exactly one file keeps the editable title field; 2+ files
  // replace it with a per-file filename list — renaming happens afterwards,
  // per source, in the Quellen-Liste, not in this dialog.
  const isSingle = selected.length === 1

  function updateFile(id: string, patch: Partial<SelectedFile>) {
    setSelected((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    )
  }

  function removeFile(id: string) {
    setSelected((prev) => {
      const next = prev.filter((entry) => entry.id !== id)
      if (next.length === 1 && !titleTouched) {
        setTitle(stripKnownExtension(next[0].file.name))
      }
      return next
    })
  }

  function pickFiles(fileList: FileList | null | undefined) {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)

    // Validate against the shared format registry, so this pre-check can
    // never drift from what the server will actually accept. It is only a
    // UX shortcut — `createFileSourceAction` re-derives the type server-side
    // and the worker re-checks the real bytes.
    for (const file of files) {
      const detected = detectFileFormat(file.name, file.type)
      if (!detected.ok) {
        // Video gets its own message: dropping an .mp4 is a deliberate act,
        // and "Dateityp nicht erlaubt" would read like a bug rather than a
        // scope decision.
        setValidationError(
          detected.reason === "video"
            ? INGESTION_MESSAGES.videoUnsupported
            : INGESTION_MESSAGES.unsupportedFileType
        )
        return
      }

      // Per-format cap, named in the message — a shared "max 20MB" would be
      // wrong for an image (5MB, bounded by the vision API) and misleading
      // about which limit was actually hit.
      const spec = FILE_FORMATS[detected.type]
      if (file.size > spec.maxBytes) {
        setValidationError(
          `${spec.label}: maximal ${formatByteLimit(spec.maxBytes)} pro Datei (${
            file.name
          } ist ${formatMb(file.size)} groß).`
        )
        return
      }
    }

    setValidationError(null)
    const entries = toSelectedFiles(files)
    setSelected(entries)

    if (entries.length === 1 && !titleTouched) {
      setTitle(stripKnownExtension(entries[0].file.name))
    }
  }

  async function submitOne(entry: SelectedFile): Promise<boolean> {
    updateFile(entry.id, { status: "uploading", error: null })

    try {
      let target = entry.pendingUpload

      if (!target) {
        const bytes = new Uint8Array(await entry.file.arrayBuffer())
        const contentHash = await sha256Hex(bytes)
        const resolvedTitle = isSingle
          ? title.trim() || stripKnownExtension(entry.file.name)
          : stripKnownExtension(entry.file.name)

        const createResult = await createFileSourceAction({
          notebookId,
          title: resolvedTitle,
          fileName: entry.file.name,
          fileSizeBytes: entry.file.size,
          // Advisory only — the action re-derives the real type from the
          // file name plus this value, and never trusts it alone.
          fileMimeType: entry.file.type,
          contentHash,
        })
        if ("error" in createResult) {
          updateFile(entry.id, { status: "error", error: createResult.error })
          return false
        }
        target = createResult.data
      }

      const supabase = createBrowserClient()
      const { error: uploadError } = await supabase.storage
        .from(SOURCES_BUCKET)
        .upload(target.storagePath, entry.file, { upsert: false })

      if (uploadError) {
        updateFile(entry.id, {
          status: "error",
          error: "Der Upload wurde nicht abgeschlossen. Bitte erneut versuchen.",
          pendingUpload: target,
        })
        return false
      }

      const processResult = await processSourceAction({ sourceId: target.sourceId })
      if ("error" in processResult) {
        updateFile(entry.id, {
          status: "error",
          error: processResult.error,
          pendingUpload: target,
        })
        return false
      }

      updateFile(entry.id, { status: "done", error: null, pendingUpload: null })
      return true
    } catch {
      updateFile(entry.id, {
        status: "error",
        error: "Unerwarteter Fehler — bitte erneut versuchen.",
      })
      return false
    }
  }

  const targets = selected.filter((entry) => entry.status !== "done")
  const isRetry = targets.length > 0 && targets.every((entry) => entry.status === "error")

  function handleSubmit() {
    if (targets.length === 0) return

    startTransition(async () => {
      // Task 4: every file gets its own row/job, submitted independently —
      // one file's rejection/failure (e.g. a dedupe hit) can never touch
      // another's `Promise`, so a failure in file 2 leaves 1 and 3
      // untouched.
      const results = await Promise.all(targets.map((entry) => submitOne(entry)))
      if (results.every(Boolean)) onDone()
    })
  }

  const canSubmit = selected.length > 0 && !validationError && targets.length > 0

  return (
    <div className="space-y-4 pt-2">
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors",
          dragActive && "border-[var(--action)] bg-muted/50"
        )}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          pickFiles(event.dataTransfer.files)
        }}
        data-test="file-upload-dropzone"
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
        {selected.length === 0 && (
          <p className="text-sm text-muted-foreground">
            PDF, Word, Excel, CSV, Text, Markdown oder Bild hierher ziehen
            oder auswählen
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          data-test="file-upload-picker-button"
        >
          Datei(en) auswählen
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          className="sr-only"
          onChange={(event) => pickFiles(event.target.files)}
          data-test="file-upload-file-input"
        />
      </div>

      {validationError && (
        <p
          className="text-sm text-destructive"
          data-test="file-upload-validation-error"
        >
          {validationError}
        </p>
      )}

      {isSingle && (
        <>
          {selected[0].error && (
            <Alert variant="destructive" data-test="file-upload-error">
              <AlertDescription>{selected[0].error}</AlertDescription>
            </Alert>
          )}
          <p
            className="flex items-center gap-1.5 text-sm text-foreground"
            data-test="file-upload-file-summary"
          >
            {selected[0].file.name} · {formatMb(selected[0].file.size)}
            {selected[0].status === "uploading" && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            )}
          </p>
          <div className="space-y-2">
            <Label htmlFor="pdf-source-title">Titel</Label>
            <Input
              id="pdf-source-title"
              value={title}
              onChange={(event) => {
                setTitleTouched(true)
                setTitle(event.target.value)
              }}
              data-test="file-upload-title-input"
            />
          </div>
        </>
      )}

      {selected.length >= 2 && (
        <ul className="space-y-1.5" data-test="file-upload-file-list">
          {selected.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              data-test={`file-upload-file-row-${entry.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {stripKnownExtension(entry.file.name)} · {formatMb(entry.file.size)}
                </p>
                {entry.status === "uploading" && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                    Wird hochgeladen…
                  </p>
                )}
                {entry.status === "done" && (
                  <p className="text-xs text-[var(--ok)]">Hochgeladen</p>
                )}
                {entry.status === "error" && entry.error && (
                  <p
                    className="text-xs text-[var(--danger)]"
                    data-test={`file-upload-file-error-${entry.id}`}
                  >
                    {entry.error}
                  </p>
                )}
              </div>
              {entry.status !== "uploading" && entry.status !== "done" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeFile(entry.id)}
                  aria-label={`„${entry.file.name}“ entfernen`}
                  data-test={`file-upload-file-remove-${entry.id}`}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || pending}
          data-test="file-upload-submit"
        >
          {pending ? "Wird hochgeladen…" : isRetry ? "Erneut versuchen" : "Hochladen"}
        </Button>
      </div>
    </div>
  )
}
