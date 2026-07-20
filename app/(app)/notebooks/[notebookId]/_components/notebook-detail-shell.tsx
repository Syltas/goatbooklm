"use client"

import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PanelTopClose,
  PanelTopOpen,
  X,
} from "lucide-react"
import { useState } from "react"

import { ChatPanel } from "@/components/chat/chat-panel"
import type { OnCiteArgs } from "@/components/chat/citation-chip"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { Notebook } from "@/lib/notebooks/service"
import type { ChatUIMessage } from "@/lib/chat/types"
import { cn } from "@/lib/utils"

import { SourcesPanel } from "../sources/_components/sources-panel"
import { ChatHeaderMenu } from "./chat-header-menu"
import { useSourcesPolling } from "../sources/_components/use-sources-polling"
import type { SourceWithChunkCount } from "../sources/types"
import { StudioPanel } from "../studio/_components/studio-panel"
import { PANEL_LABEL, type PanelKey } from "./panel-placeholders"
import { SourceReaderProvider, useSourceReader } from "./source-reader-context"

function CollapseIcon({
  panelKey,
  collapsed,
}: {
  panelKey: PanelKey
  collapsed: boolean
}) {
  if (panelKey === "sources") {
    return collapsed ? <PanelLeftOpen /> : <PanelLeftClose />
  }
  if (panelKey === "studio") {
    return collapsed ? <PanelRightOpen /> : <PanelRightClose />
  }
  return collapsed ? <PanelTopOpen /> : <PanelTopClose />
}

interface DesktopPanelProps {
  panelKey: PanelKey
  collapsed: boolean
  onToggle: () => void
  /** Width/flex classes applied only while expanded. */
  expandedClassName: string
  /** Panel-specific controls in the header, left of the collapse toggle.
   *  Hidden while collapsed — the w-14 rail only has room for the toggle. */
  headerActions?: React.ReactNode
  children: React.ReactNode
}

function DesktopPanel({
  panelKey,
  collapsed,
  onToggle,
  expandedClassName,
  headerActions,
  children,
}: DesktopPanelProps) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col",
        collapsed ? "w-14 shrink-0" : expandedClassName
      )}
      aria-label={PANEL_LABEL[panelKey]}
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        {!collapsed && (
          <h2 className="truncate text-sm font-medium text-foreground">
            {PANEL_LABEL[panelKey]}
          </h2>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!collapsed && headerActions}
          {/* Collapse toggles are a desktop-only affordance (AC-45): on
              mobile, Chat is always full-bleed and Sources/Studio open via
              the bottom-tab sheet below — collapsing a panel down to a
              useless w-14 sliver has no purpose there, and would strand the
              Chat panel (its only mobile panel) in a collapsed state with
              no way back short of widening the viewport. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden md:inline-flex"
            onClick={onToggle}
            data-test={`${panelKey}-panel-collapse`}
            aria-label={
              collapsed
                ? `${PANEL_LABEL[panelKey]}-Panel einblenden`
                : `${PANEL_LABEL[panelKey]}-Panel ausblenden`
            }
          >
            <CollapseIcon panelKey={panelKey} collapsed={collapsed} />
          </Button>
        </div>
      </header>
      {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>}
    </section>
  )
}

type MobilePanel = "sources" | "studio"

/**
 * Bridges the Chat panel to the shared `SourceReaderProvider` (§7 Highlight-
 * Bridge) — this is the only mount of `ChatPanel` (unlike Sources, Chat has
 * no separate desktop/mobile-sheet mount, it's always visible, see
 * DESIGN.md's layout), so `onCite` both flips the reader context AND — on a
 * mobile viewport, where Sources/Studio live behind the bottom-sheet — opens
 * that sheet so the reader jump is actually visible (AC-51). Rendered
 * *inside* `SourceReaderProvider` (below), so `useSourceReader()` is valid
 * here even though the shell itself sits outside the provider it renders.
 */
function ChatPanelSlot({
  notebookId,
  initialMessages,
  readyCount,
  onMobileReaderOpen,
  historyClearedAt,
  onMessageCountChange,
  injectedPrompt,
}: {
  notebookId: string
  initialMessages: ChatUIMessage[]
  readyCount: number
  onMobileReaderOpen: () => void
  historyClearedAt: number
  onMessageCountChange: (count: number) => void
  injectedPrompt: { text: string; nonce: number } | null
}) {
  const { openSource } = useSourceReader()

  function handleCite({ sourceId, charStart, charEnd }: OnCiteArgs) {
    openSource(sourceId, { charStart, charEnd })

    // Desktop already shows the Sources-Panel inline — no sheet to open.
    // `matchMedia` (not a hook/state) is checked at click time so this never
    // fires from a desktop viewport just because the window was once
    // narrow.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      onMobileReaderOpen()
    }
  }

  return (
    <ChatPanel
      notebookId={notebookId}
      initialMessages={initialMessages}
      readyCount={readyCount}
      onCite={handleCite}
      historyClearedAt={historyClearedAt}
      onMessageCountChange={onMessageCountChange}
      injectedPrompt={injectedPrompt}
    />
  )
}

export function NotebookDetailShell({
  notebook,
  initialSources,
  initialMessages,
}: {
  notebook: Notebook
  initialSources: SourceWithChunkCount[]
  initialMessages: ChatUIMessage[]
}) {
  const [collapsed, setCollapsed] = useState<Record<PanelKey, boolean>>({
    sources: false,
    chat: false,
    studio: false,
  })
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null)

  // Chat-Header-Menü state. `historyClearedAt` is a bump counter, not a
  // boolean — clearing twice in one session must produce two distinct values
  // for `ChatPanel`'s effect to fire again.
  const [historyClearedAt, setHistoryClearedAt] = useState(0)
  const [messageCount, setMessageCount] = useState(initialMessages.length)

  // Studio→Chat Explain-Bridge (docs/specs/studio-quick-wins.md): der
  // Studio-Viewer reicht einen fertigen Prompt hoch, der Chat sendet ihn
  // als User-Turn. Auf Mobile zusätzlich das Studio-Sheet schließen, damit
  // der Chat (dahinter) sichtbar wird.
  const [explainPrompt, setExplainPrompt] = useState<{
    text: string
    nonce: number
  } | null>(null)

  function handleExplain(text: string) {
    setExplainPrompt((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }))
    setMobilePanel(null)
  }

  // Lifted above both the desktop and mobile-sheet mounts of the
  // Sources-Panel body (see the two `<SourcesPanel>` call sites below) so
  // the 2s status poll (specs/02-ingestion.md §4 Punkt 5) runs exactly
  // once regardless of which mount is currently visible, instead of each
  // mount independently polling.
  const { sources, addSource, removeSource } = useSourcesPolling(
    notebook.id,
    initialSources
  )

  // Derived from the SAME live-polled `sources` the Sources-Panel renders
  // (not a static server prop refreshed only on `router.refresh()`) — the
  // Chat input unlocks the instant a source's status flips to `ready`,
  // without waiting on a full RSC round trip (AC-B1).
  const readyCount = sources.filter((source) => source.status === "ready").length

  function toggle(panel: PanelKey) {
    setCollapsed((prev) => ({ ...prev, [panel]: !prev[panel] }))
  }

  return (
    <SourceReaderProvider>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center border-b border-border px-6 py-3">
          <h1 className="truncate text-lg font-medium text-foreground">
            {notebook.title}
          </h1>
        </div>

        <div className="flex min-h-0 flex-1 divide-x divide-border overflow-hidden">
          <DesktopPanel
            panelKey="sources"
            collapsed={collapsed.sources}
            onToggle={() => toggle("sources")}
            expandedClassName="hidden w-[300px] shrink-0 md:flex"
          >
            <SourcesPanel
              notebookId={notebook.id}
              sources={sources}
              onCreated={addSource}
              onDeleted={removeSource}
            />
          </DesktopPanel>

          <DesktopPanel
            panelKey="chat"
            collapsed={collapsed.chat}
            onToggle={() => toggle("chat")}
            expandedClassName="flex min-w-0 flex-1"
            headerActions={
              <ChatHeaderMenu
                notebookId={notebook.id}
                hasHistory={messageCount > 0}
                onHistoryDeleted={() => setHistoryClearedAt((value) => value + 1)}
              />
            }
          >
            <ChatPanelSlot
              notebookId={notebook.id}
              initialMessages={initialMessages}
              readyCount={readyCount}
              onMobileReaderOpen={() => setMobilePanel("sources")}
              historyClearedAt={historyClearedAt}
              onMessageCountChange={setMessageCount}
              injectedPrompt={explainPrompt}
            />
          </DesktopPanel>

          <DesktopPanel
            panelKey="studio"
            collapsed={collapsed.studio}
            onToggle={() => toggle("studio")}
            expandedClassName="hidden w-[300px] shrink-0 md:flex"
          >
            <StudioPanel
              notebookId={notebook.id}
              sources={sources}
              onExplain={handleExplain}
            />
          </DesktopPanel>
        </div>

        {/* Mobile panel navigation (<=768px, AC-45): Chat is the full-bleed
            default panel above; Sources/Studio open as a bottom-sheet overlay
            via this tab bar instead of an inline collapse rail. */}
        <div className="flex shrink-0 items-center justify-around border-t border-border py-1 md:hidden">
          <Button
            type="button"
            variant="ghost"
            className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-xs"
            onClick={() => setMobilePanel("sources")}
            data-test="notebook-mobile-tab-sources"
          >
            <PanelLeftOpen className="size-5" />
            Quellen
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-xs"
            onClick={() => setMobilePanel("studio")}
            data-test="notebook-mobile-tab-studio"
          >
            <PanelRightOpen className="size-5" />
            Studio
          </Button>
        </div>

        <Dialog
          open={mobilePanel !== null}
          onOpenChange={(open) => !open && setMobilePanel(null)}
        >
          <DialogContent
            showCloseButton={false}
            data-test={mobilePanel ? `notebook-mobile-${mobilePanel}-sheet` : undefined}
            className="inset-x-0 top-auto bottom-0 left-0 h-[75dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-2xl rounded-b-none p-0 sm:max-w-none"
          >
            <DialogTitle className="sr-only">
              {mobilePanel ? PANEL_LABEL[mobilePanel] : ""}
            </DialogTitle>
            <div className="flex h-full flex-col">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
                <h2 className="text-sm font-medium text-foreground">
                  {mobilePanel ? PANEL_LABEL[mobilePanel] : ""}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex h-11 w-11 items-center justify-center rounded-lg"
                  onClick={() => setMobilePanel(null)}
                  aria-label="Schließen"
                  data-test="notebook-mobile-sheet-close"
                >
                  <X className="size-5" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {mobilePanel === "sources" && (
                  <SourcesPanel
                    notebookId={notebook.id}
                    sources={sources}
                    onCreated={addSource}
                    onDeleted={removeSource}
                  />
                )}
                {mobilePanel === "studio" && (
                  <StudioPanel
                    notebookId={notebook.id}
                    sources={sources}
                    onExplain={handleExplain}
                  />
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </SourceReaderProvider>
  )
}
