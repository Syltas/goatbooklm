"use client"

import { ArrowLeft, Copy } from "lucide-react"
import type { ReactNode } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { ReportMarkdown } from "./report-markdown"

interface ReportViewerProps {
  title: string
  markdown: string
  /** Blinkender Cursor + kein Kebab, solange der Stream läuft. */
  streaming: boolean
  onBack: () => void
  /** Kebab-Menü (Umbenennen/Löschen) — nur für persistierte Berichte. */
  menu?: ReactNode
}

/**
 * Panel-interner Viewer (Spec "report-viewer"): Breadcrumb „Studio › Bericht",
 * kein Route-Wechsel. Rendert sowohl den Live-Stream als auch persistierte
 * Berichte — der Unterschied ist nur `streaming` + `menu`.
 */
export function ReportViewer({
  title,
  markdown,
  streaming,
  onBack,
  menu,
}: ReportViewerProps) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`# ${title}\n\n${markdown}`)
      toast.success("Bericht kopiert.")
    } catch {
      toast.error("Kopieren fehlgeschlagen.")
    }
  }

  return (
    <div className="flex h-full flex-col" data-test="report-viewer">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Zurück zum Studio"
          data-test="report-viewer-back"
        >
          <ArrowLeft />
        </Button>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Studio <span aria-hidden="true">›</span> Bericht
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
          disabled={streaming}
          aria-label="Bericht kopieren"
          data-test="report-viewer-copy"
        >
          <Copy />
        </Button>
        {!streaming && menu}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <h3
          className="mb-3 text-[17px] leading-snug font-semibold text-foreground"
          data-test="report-viewer-title"
        >
          {title}
        </h3>
        <div data-test="report-viewer-body">
          <ReportMarkdown content={markdown} />
          {streaming && (
            <span
              className="ml-0.5 inline-block h-4 w-1.5 align-middle bg-muted-foreground motion-safe:animate-pulse"
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  )
}
