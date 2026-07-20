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
import { useEffect, useRef, useState } from "react"
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type LayoutChangedMeta,
  type PanelImperativeHandle,
} from "react-resizable-panels"

import { ChatPanel } from "@/components/chat/chat-panel"
import type { OnCiteArgs } from "@/components/chat/citation-chip"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { Notebook } from "@/lib/notebooks/service"
import type { Note } from "@/lib/notes/service"
import type { ChatUIMessage } from "@/lib/chat/types"
import { cn } from "@/lib/utils"

import { NotesPanel, type NotesPanelHandle } from "../notes/_components/notes-panel"
import { useNotesState } from "../notes/_components/use-notes-state"
import { SourcesPanel } from "../sources/_components/sources-panel"
import { ChatHeaderMenu } from "./chat-header-menu"
import { useSourcesPolling } from "../sources/_components/use-sources-polling"
import type { SourceWithChunkCount } from "../sources/types"
import { PANEL_LABEL, type PanelKey } from "./panel-placeholders"
import { SourceReaderProvider, useSourceReader } from "./source-reader-context"
import { useNotebookSummaryPolling } from "./use-notebook-summary-polling"

// The collapsed rail is a fixed CONTROL size (matches Tailwind's `w-14`),
// not a share of the available width — it stays a literal pixel value on
// purpose even though every other Panel dimension below is percentage-based
// (Requirement: relative widths, but the rail is explicitly exempt).
const RAIL_WIDTH_PX = 56

// Prozent-Ranges fürs Ziehen.
//
// Vorrangregel (sonst wäre die Anforderung in sich widersprüchlich): erreicht
// eine Drag-Geste eine dieser Grenzen, gewinnt IMMER die Grenze —
// react-resizable-panels stoppt den Resize dort, statt sie zu überschreiten.
// Die Verhältniswahrung zwischen den beiden benachbarten Panels ist damit nur
// best-effort: Wer über `maxSize` hinaus zieht, bekommt exakt `maxSize`, auch
// wenn das Nachbar-Panel dadurch nicht im ursprünglich anvisierten Verhältnis
// mitschrumpft/-wächst.
//
// Deliberately no per-Panel `defaultSize` here (see the fallback layout
// constants below for why) — only the drag range lives on the Panel itself.
const SIDEBAR_SIZING = { minSize: "15%", maxSize: "32%" } as const
// Both sidebars maxing out at once (32% × 2) already floors Chat at 36%, so
// this 30% can never actually bind today — it's a forward guard, not dead
// weight: if `SIDEBAR_SIZING.maxSize` is ever raised without revisiting this
// value, Chat stops silently shrinking toward unusable once the two floors
// cross, instead of only failing at the worst possible (widest-sidebar) case.
const CHAT_SIZING = { minSize: "30%" } as const

const PANEL_GROUP_ID = "notebook-detail-panels"

// `Panel`'s `id` prop lands on a real DOM `id` attribute (rest props not in
// its own destructure land on the outer div — verified). Bare words like
// "sources"/"chat"/"studio" are exactly the kind of id another element on
// the page could collide with; prefixed so that can't happen. These are
// also the keys `Layout` objects (below, and anything the library hands
// back via `onLayoutChanged`) use, so every other constant here is derived
// from this one map rather than re-typing the strings.
const PANEL_DOM_ID = {
  sources: "nb-panel-sources",
  chat: "nb-panel-chat",
  studio: "nb-panel-studio",
} as const satisfies Record<PanelKey, string>

const PANEL_DOM_IDS = Object.values(PANEL_DOM_ID)

// User-global (no notebook.id in the key) so the restored ratio survives
// both a reload and switching to a different notebook.
const PANEL_LAYOUT_STORAGE_KEY = "notebook-detail-panel-layout"

// First-ever-visit fallback (before anything is in localStorage).
const FALLBACK_LAYOUT: Layout = {
  [PANEL_DOM_ID.sources]: 20,
  [PANEL_DOM_ID.chat]: 60,
  [PANEL_DOM_ID.studio]: 20,
}

// Deliberately NOT fed into `Group`'s `defaultLayout` *prop* — the library
// only ever consults that prop at the moment a Panel set first *registers*,
// and the server has no `localStorage` to read, so that first registration
// always sees `FALLBACK_LAYOUT`. Neither changing the prop afterwards
// (ordinary React state) nor `useDefaultLayout` (the library's own hook,
// including its `panelIds` option — tried with all three Panels stably
// mounted, per the comment above `groupRef` below) ever re-applies a value
// retroactively to already-registered Panels; `useDefaultLayout` also
// reintroduced a React #419 hydration error that plain `setLayout` (see
// `groupRef` below) doesn't have. Both verified empirically, not assumed.
function readStoredLayout(): Layout | undefined {
  try {
    const raw = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined
    }
    const keys = Object.keys(parsed)
    // `setLayout` (below) matches by *count*, not these key names — and an
    // empty `{}`/`[]` passes `Array.prototype.every` vacuously, sailing
    // through as a "valid" Layout only to make `setLayout` throw ("Invalid 3
    // panel layout: …") inside a `useEffect`. That's an uncaught throw the
    // nearest error boundary turns into a dead page — and since the bad
    // value is never overwritten, every later load is equally dead. Exact
    // key-SET matching (not just a count) also means a future 4th panel
    // fails this check safely instead of crashing every returning user.
    if (
      keys.length !== PANEL_DOM_IDS.length ||
      !PANEL_DOM_IDS.every((id) => keys.includes(id))
    ) {
      return undefined
    }
    if (!Object.values(parsed).every((value) => typeof value === "number")) {
      return undefined
    }
    return parsed as Layout
  } catch {
    // Corrupted/foreign value under this key — ignore, fall back to default.
  }
  return undefined
}

function writeStoredLayout(layout: Layout) {
  try {
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Private-mode quota, storage disabled, etc. — persistence is
    // best-effort and never blocks resizing itself.
  }
}

// Compares two Layouts by value (not `Object.is`/`===`, which `Layout`
// percentages will never satisfy across two separate `setLayout` calls even
// when "the same" restore succeeded twice) — used only to decide whether the
// retry in the `groupRef` effect below is still necessary.
function layoutsMatch(a: Layout, b: Layout): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => Math.abs((a[key] ?? 0) - (b[key] ?? 0)) < 0.01)
}

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

interface PanelChromeProps {
  panelKey: PanelKey
  collapsed: boolean
  onToggle: () => void
  /** Panel-specific controls in the header, left of the collapse toggle.
   *  Hidden while collapsed — the w-14 rail only has room for the toggle. */
  headerActions?: React.ReactNode
  children: React.ReactNode
}

/**
 * Header + body chrome rendered *inside* each `react-resizable-panels`
 * `Panel` (see the `Group` below). The width/flex sizing itself lives on
 * the `Panel` component now (percentage `defaultSize`/`minSize`/`maxSize`,
 * pixel `collapsedSize`) — this component only owns what used to be the
 * whole `<section>`'s contents: the header row and the collapse-conditional
 * body.
 */
function PanelChrome({
  panelKey,
  collapsed,
  onToggle,
  headerActions,
  children,
}: PanelChromeProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        {!collapsed && (
          <h2 className="truncate text-[14.5px] font-bold text-foreground">
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
            className="hidden size-8 rounded-full text-muted-foreground md:inline-flex"
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
    </div>
  )
}

// Visible drag bar between two Panels. `role="separator"`, focusability and
// arrow-key/Home/End resizing all come for free from react-resizable-panels'
// `Separator` — nothing custom to wire up for that. `data-separator`
// (idle/hover/active/focus/disabled, set by the library) drives the color
// swap; only DESIGN.md's existing tokens are used (`--border` at rest,
// `--action` for hover/active/focus — same blue as the focus ring
// elsewhere), so dark mode keeps working without a separate branch.
//
// `hidden md:block` works directly here (own single element, no
// inner-vs-outer wrapper split) — unlike Sources/Studio's `Panel`s below,
// which need the `data-desktop-only` detour; see the comment above `Group`.
// Resting state is transparent — v2's floating panel cards (12px gap, see
// the `Group`'s `gap-1` + this handle's own `w-1` below, which together add
// up to that 12px) replace the old always-visible divider line; the handle
// still occupies real space and is still fully focusable/draggable, it just
// doesn't paint a line until the user actually reaches for it.
const RESIZE_HANDLE_CLASSNAME = cn(
  "hidden w-1 shrink-0 cursor-col-resize bg-transparent outline-none transition-colors md:block",
  "hover:bg-[var(--action)] data-[separator=active]:bg-[var(--action)]",
  "focus-visible:bg-[var(--action)] focus-visible:ring-2 focus-visible:ring-[var(--action)] focus-visible:ring-offset-0"
)

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
  notebookSummary,
  onMobileReaderOpen,
  historyClearedAt,
  onMessageCountChange,
}: {
  notebookId: string
  initialMessages: ChatUIMessage[]
  readyCount: number
  notebookSummary: string | null
  onMobileReaderOpen: () => void
  historyClearedAt: number
  onMessageCountChange: (count: number) => void
}) {
  const { openSource } = useSourceReader()

  function handleCite({ sourceId, charStart, charEnd, sourceTitle }: OnCiteArgs) {
    openSource(sourceId, { charStart, charEnd, sourceTitle })

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
      notebookSummary={notebookSummary}
      onCite={handleCite}
      historyClearedAt={historyClearedAt}
      onMessageCountChange={onMessageCountChange}
    />
  )
}

export function NotebookDetailShell({
  notebook,
  initialSources,
  initialMessages,
  initialNotes,
}: {
  notebook: Notebook
  initialSources: SourceWithChunkCount[]
  initialMessages: ChatUIMessage[]
  initialNotes: Note[]
}) {
  const [collapsed, setCollapsed] = useState<Record<PanelKey, boolean>>({
    sources: false,
    chat: false,
    studio: false,
  })
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null)

  // Sources/Studio/Chat are ALL unconditionally mounted, on every viewport —
  // no JS-computed "is this desktop" branch decides what's *in the tree*
  // (that used to exist here — a `Panel`+`Separator` pair only rendered
  // above 768px, to route around `className` not reaching `Panel`'s outer
  // sizing wrapper; see the CSS-only replacement in the comment above
  // `Group` in the JSX). Two reasons it came back out:
  //
  // - The server has no viewport to guess from, so its "desktop?" guess was
  //   always "yes" — on an actual phone, the first client render then
  //   emitted a *different child count* (3 Panels + 2 Separators vs. 1 + 0),
  //   a structural mismatch React 19 can't patch during hydration, only
  //   discard-and-client-rerender. No `Suspense` boundary in this app means
  //   that discard happened at the root — `SourceReaderProvider`,
  //   `useSourcesPolling`, `ChatPanel`'s `useChat` (with `initialMessages`)
  //   all got thrown away and remounted on every cold mobile load (confirmed
  //   via `pageerror` events during testing, not just reasoned about).
  // - Independently, flipping that same boolean live (e.g. rotating a
  //   tablet across 768px mid-session) unmounted `SourcesPanel` — which
  //   holds real local state (an open "add source" dialog, in-progress
  //   input) — silently discarding it.
  //
  // Both trace back to the same thing: a Panel's *presence in the tree*
  // depended on a value only knowable client-side, after the fact. Every
  // Panel unconditionally mounted sidesteps that category of bug — identical
  // markup from the server's guess-free first paint through every viewport
  // change, nothing keyed to viewport state to lose on a resize.
  const groupRef = useRef<GroupImperativeHandle | null>(null)

  useEffect(() => {
    const stored = readStoredLayout()
    if (!stored) return

    function applyStoredLayout() {
      try {
        // Validated+clamped, key-matching Layout never throws here — but a
        // corrupted-yet-key-matching value (e.g. NaN slipping the `typeof
        // ... === "number"` check in `readStoredLayout`) still shouldn't
        // crash the tree from inside an effect.
        return groupRef.current?.setLayout(stored!)
      } catch {
        return undefined
      }
    }

    const applied = applyStoredLayout()
    // While the Group hasn't measured its size yet (`defaultLayoutDeferred`
    // internally — not exposed on the imperative handle, inferred from the
    // return value instead), `setLayout` silently no-ops and hands back the
    // *previous*, un-restored layout — persistence would otherwise stop
    // working with no trace. One retry a frame later (layout/paint has
    // happened by then) covers it; a matching return needs no retry, and a
    // repeat `setLayout` call with the same value is a harmless no-op.
    if (!applied || !layoutsMatch(applied, stored)) {
      requestAnimationFrame(applyStoredLayout)
    }
  }, [])

  // `Group` calls this on every layout recompute, including the initial
  // mount AND the `setLayout()` call above — both marked
  // `meta.isUserInteraction: false` (see the library's own "Initial mount
  // is not a user interaction" comment, which the same rule extends to
  // imperative API calls). Only persist drags/keyboard resizes — genuine
  // user intent — so restoring a layout never immediately re-writes itself
  // back out, and a session where nothing was ever dragged never overwrites
  // a real saved ratio with the plain default.
  function handleLayoutChanged(layout: Layout, meta: LayoutChangedMeta) {
    if (meta.isUserInteraction) {
      writeStoredLayout(layout)
    }
  }

  // Imperative Panel handles — used by `toggle()` to drive collapse/expand,
  // and read back inside `handlePanelResize` to keep `collapsed` in sync
  // when a *drag* (not a button click) pushes a panel below its `minSize`
  // and the library auto-collapses it (a `collapsible` Panel does this on
  // its own; see the `collapsible` prop below).
  const sourcesPanelRef = useRef<PanelImperativeHandle | null>(null)
  const chatPanelRef = useRef<PanelImperativeHandle | null>(null)
  const studioPanelRef = useRef<PanelImperativeHandle | null>(null)
  const panelRefs: Record<PanelKey, React.RefObject<PanelImperativeHandle | null>> = {
    sources: sourcesPanelRef,
    chat: chatPanelRef,
    studio: studioPanelRef,
  }

  // Chat-Header-Menü state. `historyClearedAt` is a bump counter, not a
  // boolean — clearing twice in one session must produce two distinct values
  // for `ChatPanel`'s effect to fire again.
  const [historyClearedAt, setHistoryClearedAt] = useState(0)
  const [messageCount, setMessageCount] = useState(initialMessages.length)

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

  // Part A (empty-chat summary) — the server-rendered `notebook.summary`
  // snapshot only reflects what existed at PAGE LOAD. If a source is still
  // being ingested when the page loads, the worker generates the summary
  // sometime after, and this poll is the only way the client ever learns it
  // exists without a manual reload (see `use-notebook-summary-polling.ts`).
  const notebookSummary = useNotebookSummaryPolling(
    notebook.id,
    readyCount,
    notebook.summary_stale ? null : notebook.summary
  )

  // Bugfix Befund 6 — lifted above both mounts of the Notes-Panel body for
  // the same reason `sources` above is lifted: without this, each
  // `NotesPanel` mount tracked its own list independently, only re-synced
  // on the next full server round trip. See `use-notes-state.ts`.
  const { notes, addNote, updateNote, removeNote } = useNotesState(initialNotes)

  // Only the MOBILE mount of Notes-Panel is ever conditionally unmounted
  // (the desktop one, like Sources/Chat/Studio's Panels above, is always in
  // the tree) — this ref is how `closeMobilePanel` below reaches into
  // whichever `NoteEditor` that mount currently has open, to flush a
  // still-pending autosave BEFORE the close actually unmounts it.
  const mobileNotesPanelRef = useRef<NotesPanelHandle>(null)

  // Bugfix Befund 6 — every way the mobile sheet can close (Escape, overlay
  // click via `onOpenChange`, and the explicit X button below) routes
  // through this one function instead of calling `setMobilePanel(null)`
  // directly, so none of them can bypass the flush. Awaited BEFORE the
  // state update that unmounts the sheet's content — once `setMobilePanel`
  // runs, `NoteEditor` (and its pending `setTimeout`) is gone, so the flush
  // has to happen while it's still mounted, not in its cleanup (ordering
  // between an unmounting component's own effects, e.g. TipTap's own
  // teardown, isn't something to rely on here). A no-op when the sheet
  // wasn't showing Notes, or no note was open — see `NotesPanelHandle`.
  async function closeMobilePanel() {
    await mobileNotesPanelRef.current?.flush()
    setMobilePanel(null)
  }

  function toggle(panel: PanelKey) {
    const ref = panelRefs[panel].current
    const nextCollapsed = !collapsed[panel]
    // `expand()` restores the panel to whatever size the user last dragged
    // it to before collapsing (the library tracks that internally) — not
    // back to `defaultLayout`/`FALLBACK_LAYOUT`. That's what makes
    // "collapse, then re-expand" return the user's own ratio instead of the
    // default.
    if (nextCollapsed) {
      ref?.collapse()
    } else {
      ref?.expand()
    }
    setCollapsed((prev) => ({ ...prev, [panel]: nextCollapsed }))
  }

  function handlePanelResize(panel: PanelKey) {
    return () => {
      const ref = panelRefs[panel].current
      if (!ref) return
      const isNowCollapsed = ref.isCollapsed()
      setCollapsed((prev) =>
        prev[panel] === isNowCollapsed ? prev : { ...prev, [panel]: isNowCollapsed }
      )
    }
  }

  return (
    <SourceReaderProvider>
      <div className="flex h-full flex-col">
        {/* Sources/Chat/Studio are ALWAYS mounted — full-bleed Chat on
            mobile is a pure CSS effect, not a JS one (see the big comment
            above `groupRef` for why conditional mounting was reverted).
            `Panel`'s outer, actually-sized wrapper isn't reachable through
            `className` (lands on an inner content div instead — see
            `RESIZE_HANDLE_CLASSNAME`), so `data-desktop-only` — a plain rest
            prop `Panel` forwards to that outer div, same as `role`/
            `aria-label` below — plus the matching `globals.css`
            `[data-desktop-only] { display: none }` media-query rule does
            what `hidden md:flex` in the className can't: remove the element
            from the flex row entirely below 768px. */}
        <Group
          groupRef={groupRef}
          id={PANEL_GROUP_ID}
          orientation="horizontal"
          defaultLayout={FALLBACK_LAYOUT}
          onLayoutChanged={handleLayoutChanged}
          className="min-h-0 flex-1 gap-1 px-3 pb-3"
        >
          <Panel
            id={PANEL_DOM_ID.sources}
            data-desktop-only=""
            role="region"
            aria-label={PANEL_LABEL.sources}
            panelRef={sourcesPanelRef}
            collapsible
            collapsedSize={RAIL_WIDTH_PX}
            {...SIDEBAR_SIZING}
            onResize={handlePanelResize("sources")}
            className="flex min-h-0 flex-col rounded-[16px] bg-card"
            style={{ overflow: "hidden" }}
          >
            <PanelChrome
              panelKey="sources"
              collapsed={collapsed.sources}
              onToggle={() => toggle("sources")}
            >
              <SourcesPanel
                notebookId={notebook.id}
                sources={sources}
                onCreated={addSource}
                onDeleted={removeSource}
              />
            </PanelChrome>
          </Panel>
          <Separator
            data-test="sources-chat-resize-handle"
            className={RESIZE_HANDLE_CLASSNAME}
          />

          <Panel
            id={PANEL_DOM_ID.chat}
            role="region"
            aria-label={PANEL_LABEL.chat}
            panelRef={chatPanelRef}
            collapsible
            collapsedSize={RAIL_WIDTH_PX}
            {...CHAT_SIZING}
            onResize={handlePanelResize("chat")}
            className="flex min-h-0 min-w-0 flex-col rounded-[16px] bg-card"
            style={{ overflow: "hidden" }}
          >
            <PanelChrome
              panelKey="chat"
              collapsed={collapsed.chat}
              onToggle={() => toggle("chat")}
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
                notebookSummary={notebookSummary}
                onMobileReaderOpen={() => setMobilePanel("sources")}
                historyClearedAt={historyClearedAt}
                onMessageCountChange={setMessageCount}
              />
            </PanelChrome>
          </Panel>

          <Separator
            data-test="chat-studio-resize-handle"
            className={RESIZE_HANDLE_CLASSNAME}
          />
          <Panel
            id={PANEL_DOM_ID.studio}
            data-desktop-only=""
            role="region"
            aria-label={PANEL_LABEL.studio}
            panelRef={studioPanelRef}
            collapsible
            collapsedSize={RAIL_WIDTH_PX}
            {...SIDEBAR_SIZING}
            onResize={handlePanelResize("studio")}
            className="flex min-h-0 flex-col rounded-[16px] bg-card"
            style={{ overflow: "hidden" }}
          >
            <PanelChrome
              panelKey="studio"
              collapsed={collapsed.studio}
              onToggle={() => toggle("studio")}
            >
              <NotesPanel
                notebookId={notebook.id}
                notes={notes}
                onCreated={addNote}
                onUpdated={updateNote}
                onDeleted={removeNote}
              />
            </PanelChrome>
          </Panel>
        </Group>

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
          onOpenChange={(open) => {
            if (!open) void closeMobilePanel()
          }}
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
                  onClick={() => void closeMobilePanel()}
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
                  <NotesPanel
                    ref={mobileNotesPanelRef}
                    notebookId={notebook.id}
                    notes={notes}
                    onCreated={addNote}
                    onUpdated={updateNote}
                    onDeleted={removeNote}
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
