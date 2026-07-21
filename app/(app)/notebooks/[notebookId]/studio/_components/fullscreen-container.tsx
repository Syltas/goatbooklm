"use client"

import { Maximize2, Minimize2 } from "lucide-react"
import { useEffect, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

interface FullscreenContainerProps {
  isFullscreen: boolean
  onToggle: () => void
  children: ReactNode
}

/**
 * Shared chrome around every "opened" Studio content — the 4 artifact
 * viewers (Report/Flashcards/Quiz/Audio) AND the NoteEditor, all rendered
 * from `studio-panel.tsx`'s `view` state (see there). One wrapper element
 * whose classes toggle between "in-column" and `fixed inset-0` fullscreen —
 * `children` is never unmounted/remounted by the toggle (same element
 * identity at this call site both times), so viewer-local state (an open
 * flashcard, the audio's playback position, an unsaved note draft) survives
 * switching in and out of fullscreen.
 *
 * Deliberately its own thin bar ABOVE the wrapped content rather than an
 * absolutely-positioned button over it: every viewer already fills its own
 * top-right corner with real controls (copy/download/kebab-menu), so
 * overlaying there would visually collide. This bar owns a corner that's
 * otherwise never used by any of the 5 content types.
 */
export function FullscreenContainer({
  isFullscreen,
  onToggle,
  children,
}: FullscreenContainerProps) {
  // ESC closes fullscreen (not the viewer itself) — only listens while
  // actually fullscreen, cleanly unsubscribes otherwise/on unmount.
  useEffect(() => {
    if (!isFullscreen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onToggle()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isFullscreen, onToggle])

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-background"
          : "flex h-full min-h-0 flex-col"
      }
    >
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label={isFullscreen ? "Vollbild verlassen" : "Vollbild anzeigen"}
          data-test="content-fullscreen-toggle"
        >
          {isFullscreen ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
