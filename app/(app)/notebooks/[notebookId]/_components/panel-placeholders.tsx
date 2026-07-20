// Spec 02 (Sources) replaced `SourcesPanelBody` with the real
// `sources/_components/sources-panel.tsx`; Spec 03 (Chat) replaced
// `ChatPanelBody` the same way with `components/chat/chat-panel.tsx` (see
// `notebook-detail-shell.tsx`'s `ChatPanelSlot`); notes replaced the Studio
// placeholder (`StudioPanelBody`, now removed) with
// `notes/_components/notes-panel.tsx` — the shell's collapse/mobile-overlay
// plumbing didn't change for any of the three. Only the panel labels shared
// across all three panels' chrome still live here.

export const PANEL_LABEL = {
  sources: "Quellen",
  chat: "Chat",
  studio: "Studio",
} as const

export type PanelKey = keyof typeof PANEL_LABEL
