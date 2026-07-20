"use client"

import { useCallback, useEffect, useState } from "react"

import type { Note } from "@/lib/notes/service"

/**
 * Lifts the Studio panel's notes list ABOVE both mounts of `NotesPanel`
 * (desktop + mobile bottom-sheet, `notebook-detail-shell.tsx`) — same
 * "single source of truth regardless of which mount is currently visible"
 * pattern `useSourcesPolling` already applies to `sources` (Bugfix Befund 6:
 * before this, each `NotesPanel` mount seeded its OWN `notes` state from the
 * same `initialNotes` prop independently, so a note created/renamed/deleted
 * through one mount only reached the other one after a full server
 * round trip re-rendered both from scratch).
 *
 * No polling here (unlike `useSourcesPolling`) — notes have no background
 * worker to catch up with; every mutation already goes through a Server
 * Action whose result is known synchronously, so `addNote`/`updateNote`/
 * `removeNote` are the only update path besides the server resync below.
 */
export function useNotesState(initialNotes: Note[]) {
  const [notes, setNotes] = useState(initialNotes)

  // A fresh server-rendered value (e.g. after some action's
  // `revalidatePath('/notebooks/[notebookId]')`) always wins over local
  // state — same "server resync overrides local state" precedent as
  // `useSourcesPolling`'s `initialSources` effect.
  useEffect(() => {
    setNotes(initialNotes)
  }, [initialNotes])

  const addNote = useCallback((note: Note) => {
    setNotes((prev) => [note, ...prev])
  }, [])

  const updateNote = useCallback((note: Note) => {
    setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)))
  }, [])

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }, [])

  return { notes, addNote, updateNote, removeNote }
}
