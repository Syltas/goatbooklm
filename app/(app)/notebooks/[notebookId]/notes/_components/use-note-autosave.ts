"use client"

import type { Editor } from "@tiptap/react"
import { useCallback, useEffect, useRef, useState } from "react"

import type { Note } from "@/lib/notes/service"

import { updateNoteAction } from "../actions"

const AUTOSAVE_DEBOUNCE_MS = 800

export type NoteAutosaveStatus = "idle" | "saving" | "saved" | "error"

interface UseNoteAutosaveOptions {
  noteId: string
  editor: Editor | null
  title: string
  /**
   * Bumped by the caller on every TipTap `onUpdate` — deliberately NOT the
   * document itself: holding the full JSON doc in React state would
   * re-render this component (and diff a potentially large object tree)
   * on every keystroke, when all this hook actually needs to know is
   * *that* the document changed, not *what* it changed to (it reads the
   * live doc straight off `editor.getJSON()` at save time instead).
   */
  contentRevision: number
  onSaved?: (note: Note) => void
}

interface UseNoteAutosaveResult {
  status: NoteAutosaveStatus
  errorMessage: string | null
  /** Manual retry for the error state — the same function a real
   *  title/content change schedules automatically, just invoked
   *  immediately instead of after the debounce window. */
  retry: () => void
  /**
   * Bugfix Befund 6: forces a save that's still sitting in the ~800ms
   * debounce window to run NOW, and returns a promise that resolves once it
   * (and any further save it ends up chained behind, per
   * `dirtyDuringSaveRef` below) has actually landed. `notes-panel.tsx`
   * forwards this to `notebook-detail-shell.tsx`, which awaits it before
   * closing the mobile Studio sheet: that close unmounts this editor
   * entirely, and an unmounted component's pending `setTimeout` never
   * fires — without this, whatever the user typed in the last <800ms was
   * silently dropped, not just delayed.
   */
  flush: () => Promise<void>
}

/**
 * Debounced autosave for the note editor — title and content are saved
 * together in one request per debounce window. A failed save leaves both
 * the title input and the TipTap document exactly as the user left them:
 * nothing here ever writes a server response back into the editor, only a
 * status/message out of it. That matters because a silent autosave
 * failure is worse than no autosave at all — the user keeps typing,
 * trusting it already arrived — so failure must surface (`status:
 * "error"`, `errorMessage`) and stay surfaced until the next successful
 * save or an explicit retry.
 */
export function useNoteAutosave({
  noteId,
  editor,
  title,
  contentRevision,
  onSaved,
}: UseNoteAutosaveOptions): UseNoteAutosaveResult {
  const [status, setStatus] = useState<NoteAutosaveStatus>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const skipNextScheduleRef = useRef(true)
  // Debouncing only prevents piling up *timers* — it does nothing about a
  // slow request still in flight when the next debounce window elapses.
  // These two refs serialize the actual network calls: at most one
  // `updateNoteAction` in flight at a time, with any change that happens
  // during that window queued as "one more save, once this one is done"
  // instead of firing a second overlapping request whose response could
  // land after the in-flight one's and revert the note to older content.
  const savingRef = useRef(false)
  const dirtyDuringSaveRef = useRef(false)
  // Bugfix Befund 6 — the two pieces `flush()` needs: which debounce timer
  // (if any) is still pending, so it can be fired early instead of waited
  // out; and the CURRENT save's promise, so a caller can await the request
  // that's already in flight instead of firing a redundant duplicate one.
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)

  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve())

  const performSave = useCallback((): Promise<void> => {
    if (!editor) return Promise.resolve()

    if (savingRef.current) {
      dirtyDuringSaveRef.current = true
      return inFlightRef.current ?? Promise.resolve()
    }

    savingRef.current = true
    dirtyDuringSaveRef.current = false
    setStatus("saving")
    setErrorMessage(null)

    const trimmedTitle = title.trim()
    // `structuredClone`, not `editor.getJSON()`'s return value directly:
    // ProseMirror reuses the *same* attrs object reference across
    // multiple nodes/marks that happen to share identical attrs (a memory
    // optimization) — confirmed by manual testing that a Next.js Server
    // Action argument containing repeated object references silently
    // drops the `attrs` key on the repeated occurrences (presumably RSC's
    // "Flight" wire format encoding a later duplicate as a back-reference
    // that the receiving end doesn't reconstruct the same way). Cloning
    // here guarantees every node in the payload owns an independent
    // object, so nothing shares a reference by the time it crosses the
    // server boundary.
    const content = structuredClone(editor.getJSON())

    const promise = (async () => {
      const result = await updateNoteAction({
        id: noteId,
        // Omit an empty title instead of sending it — the schema rejects
        // an empty string (`min(1)`), and a title mid-clear-and-retype
        // shouldn't block the content half of the same autosave tick.
        ...(trimmedTitle.length > 0 ? { title: trimmedTitle } : {}),
        content,
      })

      savingRef.current = false

      if ("error" in result) {
        setStatus("error")
        setErrorMessage(result.error)
      } else {
        setStatus("saved")
        onSaved?.(result.data)
      }

      // Something changed while this request was in flight — go again
      // via `saveRef` (not `performSave` directly) so the follow-up run
      // picks up the latest title/content closure, not the one this
      // request started with. Awaited (not fire-and-forget) so a caller
      // awaiting THIS promise (`flush`, or this same chain one level up)
      // only resolves once the chain has fully settled, not after just its
      // first link.
      if (dirtyDuringSaveRef.current) {
        dirtyDuringSaveRef.current = false
        await saveRef.current()
      }
    })()

    inFlightRef.current = promise
    return promise
  }, [editor, noteId, title, onSaved])

  // Keep the latest closure available to both the debounce timer and
  // `performSave`'s own "queued follow-up" call above, without either
  // retriggering the debounce window itself — only a real title/content
  // change (the effect below) should reset that, not e.g. `editor` turning
  // non-null right after mount, which would otherwise schedule a save for
  // a note that was just opened, untouched.
  useEffect(() => {
    saveRef.current = performSave
  }, [performSave])

  useEffect(() => {
    // Skip the mount-triggered run — nothing has changed yet, so there is
    // nothing to persist (and it would otherwise flash "speichert…" for a
    // note that was just opened).
    if (skipNextScheduleRef.current) {
      skipNextScheduleRef.current = false
      return
    }

    const timeout = setTimeout(() => {
      pendingTimeoutRef.current = null
      void saveRef.current()
    }, AUTOSAVE_DEBOUNCE_MS)
    pendingTimeoutRef.current = timeout

    return () => {
      clearTimeout(timeout)
      // Only clear the ref if IT was the one being torn down — `flush()`
      // may already have consumed and nulled it out before this cleanup
      // runs (e.g. a change re-triggering this effect right after a flush).
      if (pendingTimeoutRef.current === timeout) {
        pendingTimeoutRef.current = null
      }
    }
  }, [title, contentRevision])

  const flush = useCallback((): Promise<void> => {
    if (pendingTimeoutRef.current !== null) {
      clearTimeout(pendingTimeoutRef.current)
      pendingTimeoutRef.current = null
      return saveRef.current()
    }
    // Nothing scheduled: either nothing changed since the last save
    // (resolves immediately below), or a save is already in flight — await
    // THAT instead of firing a redundant duplicate request.
    return inFlightRef.current ?? Promise.resolve()
  }, [])

  return { status, errorMessage, retry: () => void saveRef.current(), flush }
}
