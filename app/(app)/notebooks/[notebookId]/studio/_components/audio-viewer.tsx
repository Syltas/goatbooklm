"use client"

import { ArrowLeft, Download } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import type { AudioScript } from "@/lib/studio/audio-schema"
import { createClient } from "@/lib/supabase/client"

interface AudioViewerProps {
  title: string
  storagePath: string
  script: AudioScript
  onBack: () => void
  menu?: ReactNode
}

const SIGNED_URL_TTL_SECONDS = 60 * 60

/**
 * Audio-Viewer (docs/specs/studio-audio.md): Player über Signed URL
 * (Browser-Client — die `studio-audio`-Bucket-Policies scopen auf den
 * Owner-Pfad, RLS trägt die Autorisierung), Download-Link, darunter das
 * Transkript aus dem persistierten Skript.
 */
export function AudioViewer({ title, storagePath, script, onBack, menu }: AudioViewerProps) {
  const supabase = useMemo(() => createClient(), [])
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [urlError, setUrlError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase.storage
        .from("studio-audio")
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
      if (cancelled) return
      if (error || !data?.signedUrl) {
        console.error("[audio-viewer] createSignedUrl failed", error)
        setUrlError(true)
        return
      }
      setSignedUrl(data.signedUrl)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [supabase, storagePath])

  const speakerCount = new Set(script.turns.map((turn) => turn.speaker)).size

  function speakerLabel(speaker: 1 | 2): string {
    if (speakerCount === 1) return "Stimme"
    return speaker === 1 ? "Host 1" : "Host 2"
  }

  return (
    <div className="flex h-full flex-col" data-test="audio-viewer">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Zurück zum Studio"
          data-test="audio-viewer-back"
        >
          <ArrowLeft />
        </Button>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Studio <span aria-hidden="true">›</span> Audio
        </p>
        {signedUrl && (
          <a
            href={signedUrl}
            download
            className="inline-flex size-8 items-center justify-center rounded-lg text-foreground hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label="Audio herunterladen"
            data-test="audio-viewer-download"
          >
            <Download className="size-4" />
          </a>
        )}
        {menu}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl rounded-xl bg-card px-6 py-5">
          <h3
            className="mb-3 text-[17px] leading-snug font-semibold text-foreground"
            data-test="audio-viewer-title"
          >
            {title}
          </h3>

          {urlError ? (
            <p className="text-sm text-[var(--danger)]" data-test="audio-viewer-error">
              Audio konnte nicht geladen werden. Bitte Seite neu laden.
            </p>
          ) : signedUrl ? (
            <audio
              controls
              src={signedUrl}
              className="w-full"
              data-test="audio-viewer-player"
            />
          ) : (
            <p className="text-sm text-muted-foreground">Audio wird geladen…</p>
          )}

          <div className="mt-5 space-y-3" data-test="audio-viewer-transcript">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Transkript
            </p>
            {script.turns.map((turn, index) => (
              <div key={index} className="text-[14px] leading-relaxed">
                <span className="font-medium text-foreground">
                  {speakerLabel(turn.speaker)}:
                </span>{" "}
                <span className="text-foreground">{turn.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
