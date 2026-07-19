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

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { Notebook } from "@/lib/notebooks/service"

import { SourcesPanel } from "../sources/_components/sources-panel"
import { useSourcesPolling } from "../sources/_components/use-sources-polling"
import type { SourceWithChunkCount } from "../sources/types"
import { ChatPanelBody, PANEL_LABEL, type PanelKey, StudioPanelBody } from "./panel-placeholders"
import { SourceReaderProvider } from "./source-reader-context"

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
  children: React.ReactNode
}

function DesktopPanel({
  panelKey,
  collapsed,
  onToggle,
  expandedClassName,
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
          className="ml-auto hidden md:inline-flex"
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
      </header>
      {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>}
    </section>
  )
}

type MobilePanel = "sources" | "studio"

export function NotebookDetailShell({
  notebook,
  initialSources,
}: {
  notebook: Notebook
  initialSources: SourceWithChunkCount[]
}) {
  const [collapsed, setCollapsed] = useState<Record<PanelKey, boolean>>({
    sources: false,
    chat: false,
    studio: false,
  })
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null)

  // Lifted above both the desktop and mobile-sheet mounts of the
  // Sources-Panel body (see the two `<SourcesPanel>` call sites below) so
  // the 2s status poll (specs/02-ingestion.md §4 Punkt 5) runs exactly
  // once regardless of which mount is currently visible, instead of each
  // mount independently polling.
  const { sources, addSource, removeSource } = useSourcesPolling(
    notebook.id,
    initialSources
  )

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
          >
            <ChatPanelBody />
          </DesktopPanel>

          <DesktopPanel
            panelKey="studio"
            collapsed={collapsed.studio}
            onToggle={() => toggle("studio")}
            expandedClassName="hidden w-[300px] shrink-0 md:flex"
          >
            <StudioPanelBody />
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
                {mobilePanel === "studio" && <StudioPanelBody />}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </SourceReaderProvider>
  )
}
