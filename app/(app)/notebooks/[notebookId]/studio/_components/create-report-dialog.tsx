"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { REPORT_FORMAT_META } from "@/lib/studio/format-meta"
import { REPORT_FORMAT_VALUES, type ReportFormat } from "@/lib/studio/schema"

interface CreateReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 0 ⇒ Karten disabled mit Hinweis (Spec: Route würde ohnehin 422en). */
  readyCount: number
  onSelectFormat: (format: ReportFormat) => void
}

/**
 * "Bericht erstellen"-Dialog (Spec "create-report-dialog"): exakt die 3
 * festen Format-Karten — keine Suggestions, kein "Create Your Own".
 */
export function CreateReportDialog({
  open,
  onOpenChange,
  readyCount,
  onSelectFormat,
}: CreateReportDialogProps) {
  const disabled = readyCount === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-test="create-report-dialog">
        <DialogHeader>
          <DialogTitle>Bericht erstellen</DialogTitle>
          <DialogDescription>
            {disabled
              ? "Füge zuerst eine Quelle hinzu und warte, bis sie verarbeitet ist."
              : "Wähle ein Format — der Bericht wird aus allen verarbeiteten Quellen erstellt."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {REPORT_FORMAT_VALUES.map((format) => {
            const meta = REPORT_FORMAT_META[format]
            return (
              <button
                key={format}
                type="button"
                disabled={disabled}
                onClick={() => onSelectFormat(format)}
                className="flex flex-col items-start gap-1.5 rounded-xl bg-[var(--card-3)] p-4 text-left transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                data-test={`create-report-format-${format}`}
              >
                <span className="text-sm font-medium text-foreground">{meta.label}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {meta.description}
                </span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
