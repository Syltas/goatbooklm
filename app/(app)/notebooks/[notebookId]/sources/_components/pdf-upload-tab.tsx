"use client"

import { Upload } from "lucide-react"
import { useRef, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient as createBrowserClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

import { createPdfSourceAction, processSourceAction } from "../actions"

const MAX_PDF_BYTES = 20_971_520
const SOURCES_BUCKET = "sources"

interface PdfUploadTabProps {
  notebookId: string
  /** Called once the whole (a) create-row → (b) upload → (c) enqueue flow
   *  has fully succeeded. No source row is passed back — unlike
   *  Text/Web, `createPdfSourceAction` only returns `{ sourceId,
   *  storagePath }` (§9 contract), not a full row — the new pending source
   *  shows up via the automatic Next.js router refresh that follows a
   *  Server Action calling `revalidatePath` (both `createPdfSourceAction`
   *  and `processSourceAction` do). */
  onDone: () => void
}

interface PendingUpload {
  sourceId: string
  storagePath: string
}

function stripPdfExtension(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "")
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function PdfUploadTab({ notebookId, onDone }: PdfUploadTabProps) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // AC-11: a client-side Storage-upload (or enqueue) failure leaves the
  // already-created `pending` row in place — retrying re-attempts steps
  // (b)+(c) against that SAME row instead of creating a duplicate.
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(
    null
  )
  const [dragActive, setDragActive] = useState(false)
  const [pending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function pickFile(candidate: File | undefined | null) {
    if (!candidate) return

    if (candidate.type !== "application/pdf") {
      setValidationError("Nur PDF-Dateien sind erlaubt.")
      setFile(null)
      return
    }
    if (candidate.size > MAX_PDF_BYTES) {
      setValidationError("Datei darf höchstens 20MB groß sein.")
      setFile(null)
      return
    }

    setValidationError(null)
    setSubmitError(null)
    setPendingUpload(null)
    setFile(candidate)
    setTitle((prev) => prev || stripPdfExtension(candidate.name))
  }

  async function uploadAndEnqueue(target: PendingUpload, selectedFile: File) {
    const supabase = createBrowserClient()
    const { error: uploadError } = await supabase.storage
      .from(SOURCES_BUCKET)
      .upload(target.storagePath, selectedFile, { upsert: false })

    if (uploadError) {
      setPendingUpload(target)
      setSubmitError(
        "Der Upload wurde nicht abgeschlossen. Bitte erneut versuchen."
      )
      return
    }

    const processResult = await processSourceAction({
      sourceId: target.sourceId,
    })
    if ("error" in processResult) {
      setPendingUpload(target)
      setSubmitError(processResult.error)
      return
    }

    onDone()
  }

  function handleSubmit() {
    if (!file) return
    setSubmitError(null)

    startTransition(async () => {
      if (pendingUpload) {
        await uploadAndEnqueue(pendingUpload, file)
        return
      }

      const createResult = await createPdfSourceAction({
        notebookId,
        title: title.trim() || stripPdfExtension(file.name),
        fileName: file.name,
        fileSizeBytes: file.size,
        fileMimeType: "application/pdf",
      })
      if ("error" in createResult) {
        setSubmitError(createResult.error)
        return
      }

      await uploadAndEnqueue(createResult.data, file)
    })
  }

  const canSubmit = file !== null && !validationError

  return (
    <div className="space-y-4 pt-2">
      {submitError && (
        <Alert variant="destructive" data-test="pdf-upload-error">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

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
          pickFile(event.dataTransfer.files?.[0])
        }}
        data-test="pdf-upload-dropzone"
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
        {file ? (
          <p className="text-sm text-foreground" data-test="pdf-upload-file-summary">
            {file.name} · {formatMb(file.size)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            PDF hierher ziehen oder auswählen (max. 20MB)
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          data-test="pdf-upload-picker-button"
        >
          Datei auswählen
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          onChange={(event) => pickFile(event.target.files?.[0])}
          data-test="pdf-upload-file-input"
        />
      </div>

      {validationError && (
        <p
          className="text-sm text-destructive"
          data-test="pdf-upload-validation-error"
        >
          {validationError}
        </p>
      )}

      {file && (
        <div className="space-y-2">
          <Label htmlFor="pdf-source-title">Titel</Label>
          <Input
            id="pdf-source-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            data-test="pdf-upload-title-input"
          />
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || pending}
          data-test="pdf-upload-submit"
        >
          {pending
            ? "Wird hochgeladen…"
            : pendingUpload
              ? "Erneut versuchen"
              : "Hochladen"}
        </Button>
      </div>
    </div>
  )
}
