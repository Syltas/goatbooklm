// v1 placeholder bodies for the remaining detail panels. Spec 02 (Sources)
// already replaced `SourcesPanelBody` with the real
// `sources/_components/sources-panel.tsx`; Spec 03 (Chat) will do the same
// for `ChatPanelBody` — the shell's collapse/mobile-overlay plumbing does
// not change when it does. Studio stays a placeholder in v1 by design
// (Non-Goal, AC-35/AC-37).

import { Clapperboard } from "lucide-react"

export const PANEL_LABEL = {
  sources: "Quellen",
  chat: "Chat",
  studio: "Studio",
} as const

export type PanelKey = keyof typeof PANEL_LABEL

export function ChatPanelBody() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <p>Der Chat für dieses Notizbuch folgt in Kürze.</p>
    </div>
  )
}

export function StudioPanelBody() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <Clapperboard className="size-6 text-muted-foreground" aria-hidden="true" />
      <p>Audio, Video &amp; mehr — kommt bald</p>
    </div>
  )
}
