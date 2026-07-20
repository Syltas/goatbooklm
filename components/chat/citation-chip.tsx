"use client"

import { useEffect, useRef, useState } from "react"

import { Popover, PopoverTrigger } from "@/components/ui/popover"
import type { CitationDetail } from "@/lib/chat/types"

import { CitationPopoverContent } from "./citation-popover"

export interface OnCiteArgs {
  sourceId: string
  charStart?: number
  charEnd?: number
  /** Forwarded to `SourceReaderContext.openSource`'s live-region
   *  announcement (§Teil 5) — the chip already has the source's title in
   *  `citation.sourceTitle`, so there's no reason to make the reader-jump
   *  handler re-look it up. */
  sourceTitle: string
}

interface CitationChipProps {
  citation: CitationDetail
  onCite: (args: OnCiteArgs) => void
  /** Suppresses hover-to-open while the enclosing message is still
   *  streaming — `CitationRender` renders unconditionally, so a
   *  streaming message's chips reflow as tokens keep arriving, and a
   *  hover-anchored card would visually jump or detach mid-reflow
   *  (Design-Review 2026-07-20 §Teil 3). Click/keyboard/touch are
   *  unaffected. */
  hoverDisabled?: boolean
}

const OPEN_DELAY_MS = 350
const CLOSE_DELAY_MS = 200

/**
 * Inline `[n]` marker rendered as a small, dezent `<button>` (never a
 * `<span>` — AC-G3/AC-45).
 *
 * Interaction model (Design-Review 2026-07-20, replaces the 2026-07-19
 * Popover-first rewrite — see `specs/03-chat-grounding.md` §7 for the full
 * history/rationale):
 *
 * - **Hover** (desktop, mouse only) opens the popover after `OPEN_DELAY_MS`,
 *   closes `CLOSE_DELAY_MS` after the pointer leaves (grace period so it can
 *   travel into the card itself — hovering the card keeps it open). Bound
 *   to the button's OWN `getBoundingClientRect()` (the true, visible 16×16
 *   box), not to the `after:-inset-3.5` touch-target halo below: that halo
 *   is 44×44px and overlaps 8–10px into the chat's 27.2px line height on
 *   both sides, so binding hover to it would open the card while the
 *   pointer merely rests on ordinary body text one line up/down — a
 *   geometry bug, not something a delay can paper over. `pointermove`
 *   inside the halo is still delivered to this same `<button>` (pseudo-
 *   elements don't have independent event targets), so every pointer event
 *   is checked against the true rect by hand instead of relying on native
 *   `:hover`/`mouseenter`, which — like the halo's click target — reflects
 *   the WHOLE painted box, true 16px core included.
 * - **Click** (real mouse) jumps straight into the reader — it never opens
 *   or toggles the popover. Distinguished from a keyboard-activated click
 *   (`event.detail === 0`, the standard signal for a synthetic
 *   Enter/Space-triggered click) and from a touch tap (tracked via the
 *   preceding `pointerdown`'s `pointerType`) so both of those keep opening
 *   the popover exactly as before.
 * - **Keyboard** (Enter/Space) and **touch** (tap) open the popover — Radix
 *   `PopoverTrigger`'s own click-to-toggle handles this untouched (this
 *   component only ever calls `event.preventDefault()` to suppress it for a
 *   real mouse click; a plain `return` for anything else lets it run).
 * - **"Quelle anzeigen"** inside the popover is the keyboard/touch/
 *   screen-reader jump path on every viewport (§Teil 5) — always present,
 *   never conditionally hidden.
 */
export function CitationChip({ citation, onCite, hoverDisabled }: CitationChipProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPointerTypeRef = useRef<string | null>(null)
  // "hover" vs "activation" (click/keyboard/touch) — read by the
  // onOpenAutoFocus/onCloseAutoFocus handlers below to decide whether a
  // Radix focus-in/-return should be allowed to happen at all. A pure mouse
  // hover must never move keyboard focus (nothing the user did asked for
  // that); an explicit activation should keep Radix's default so the
  // existing AC-47 focus-in/-return flow is unchanged.
  const openedViaRef = useRef<"hover" | "activation">("activation")

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  function clearOpenTimer() {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  /** Cancels any pending hover timers and closes immediately — used by the
   *  real-mouse-click jump (below) so a hover session that was mid-flight
   *  can't reopen the card a moment after the jump already navigated away. */
  function closeNow() {
    clearOpenTimer()
    clearCloseTimer()
    setOpen(false)
  }

  function scheduleHoverOpen() {
    clearCloseTimer()
    if (open || openTimerRef.current) return
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null
      openedViaRef.current = "hover"
      setOpen(true)
    }, OPEN_DELAY_MS)
  }

  function scheduleHoverClose() {
    clearOpenTimer()
    if (!open || closeTimerRef.current) return
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, CLOSE_DELAY_MS)
  }

  function isWithinTrueTarget(event: { clientX: number; clientY: number }): boolean {
    if (!buttonRef.current) return false
    // Deliberately the BUTTON's own rect, not anything derived from the
    // `after:` pseudo-element — `getBoundingClientRect()` reflects only the
    // element's border box, never an overflowing absolutely-positioned
    // pseudo-element, which is exactly the "visible 16px, not the 44px
    // halo" boundary this needs.
    const rect = buttonRef.current.getBoundingClientRect()
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    )
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (hoverDisabled || event.pointerType !== "mouse") return
    const withinTrueTarget = isWithinTrueTarget(event)
    // Instant visual feedback (background tint), decoupled from the
    // debounced open/close scheduling below — imperative DOM attribute, not
    // React state, so a fast-moving pointer doesn't force a re-render per
    // `pointermove`.
    buttonRef.current?.setAttribute("data-hovered", String(withinTrueTarget))
    if (withinTrueTarget) scheduleHoverOpen()
    else scheduleHoverClose()
  }

  function handlePointerLeave(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "mouse") return
    buttonRef.current?.setAttribute("data-hovered", "false")
    scheduleHoverClose()
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    lastPointerTypeRef.current = event.pointerType
  }

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    // `event.detail === 0` is the standard signal for a synthetic click
    // dispatched by a keyboard activation (Enter/Space) rather than a real
    // pointer click — both mouse clicks and touch taps report `detail >= 1`.
    const isKeyboardActivation = event.detail === 0
    const isRealMouseClick = !isKeyboardActivation && lastPointerTypeRef.current === "mouse"

    if (!isRealMouseClick) {
      // Keyboard Enter/Space or a touch tap — unchanged from before this
      // change: let Radix's own composed `onClick` (which runs AFTER this
      // handler returns, see `composeEventHandlers` in
      // `@radix-ui/primitive`) toggle the popover open, with the default
      // focus-in behavior allowed (see the `onOpenAutoFocus` handler below).
      openedViaRef.current = "activation"
      return
    }

    // Real desktop mouse click (§Teil 5): jump straight into the reader.
    // `preventDefault()` stops Radix's `PopoverTrigger`'s own composed
    // `onClick` (`composeEventHandlers(props.onClick, context.onOpenToggle)`)
    // from running at all — the chip's click never toggles the popover.
    event.preventDefault()
    closeNow()
    onCite({
      sourceId: citation.sourceId,
      charStart: citation.charStart,
      charEnd: citation.charEnd,
      sourceTitle: citation.sourceTitle,
    })
  }

  function handleOpenChange(next: boolean) {
    // Radix calls this for its own dismiss paths (Esc, click-outside) and
    // for the touch/keyboard open-toggle left to fall through above — route
    // every one of those through the same timer-clearing as `closeNow` so a
    // stray pending hover timer never fires after a Radix-driven change.
    clearOpenTimer()
    clearCloseTimer()
    if (next) openedViaRef.current = "activation"
    setOpen(next)
  }

  function handleOpenAutoFocus(event: Event) {
    // A mouse hover must never steal keyboard focus into the card — only an
    // explicit activation (touch tap, or Enter/Space) earns the auto-focus-
    // onto-"Quelle anzeigen" that makes AC-47's "second Enter jumps" flow
    // work.
    if (openedViaRef.current === "hover") event.preventDefault()
  }

  function handleCloseAutoFocus(event: Event) {
    // Symmetric with the above — a hover session that closes (pointer moved
    // away) must not silently yank focus onto the chip; nothing was ever
    // focused as part of it.
    if (openedViaRef.current === "hover") event.preventDefault()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* `onClick` deliberately sits on `PopoverTrigger` itself, NOT on the
          inner `<button>` below. `PopoverTrigger`'s own implementation
          composes a `props.onClick` it receives via
          `composeEventHandlers(props.onClick, context.onOpenToggle)`
          (`@radix-ui/react-popover`), which DOES respect
          `event.preventDefault()` (`@radix-ui/primitive`'s
          `composeEventHandlers` checks `defaultPrevented` by default). Put
          the SAME handler on the inner `asChild`-slotted button instead, and
          `@radix-ui/react-slot`'s `mergeProps` combines the two `onClick`s
          UNCONDITIONALLY — `event.preventDefault()` would then no longer
          stop Radix's own toggle from firing right after, and every real
          mouse click would still open/close the popover instead of jumping
          (verified against the installed package sources, not assumed). */}
      <PopoverTrigger asChild onClick={handleClick}>
        <button
          ref={buttonRef}
          type="button"
          data-test="citation-chip"
          data-citation-n={citation.n}
          aria-label={`Quelle ${citation.n} anzeigen`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          // Bugfix Befund 4: the resting/hover fills were a hardcoded light-mode-only
          // hex pair (`#eef2fe`/`#dde6fd`) sitting right next to `text-[var(--action)]` —
          // in dark mode `--action` (#8ab4f8, a light blue) would sit on that same
          // light hex fill at ~1.8:1 contrast, unreadable. Deriving both fills from
          // `--action` itself via opacity (Tailwind v4 `color-mix`) instead of a second,
          // undocumented token means light mode keeps its original look (a light blue
          // tint under a solid blue action-color) AND dark mode automatically gets a
          // dark-tinted fill under the light-blue text, which is exactly what contrast
          // needs — no separate dark-mode override to keep in sync.
          className="relative mx-[3px] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--action)]/10 px-1 align-super text-[10.5px] leading-none font-bold text-[var(--action)] outline-none after:absolute after:-inset-3.5 after:content-[''] data-[hovered=true]:bg-[var(--action)]/15 focus-visible:ring-2 focus-visible:ring-[var(--action)]"
        >
          {citation.n}
        </button>
      </PopoverTrigger>
      <CitationPopoverContent
        citation={citation}
        open={open}
        onOpenSource={() =>
          onCite({
            sourceId: citation.sourceId,
            charStart: citation.charStart,
            charEnd: citation.charEnd,
            sourceTitle: citation.sourceTitle,
          })
        }
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        onPointerEnter={clearCloseTimer}
        onPointerLeave={scheduleHoverClose}
      />
    </Popover>
  )
}
