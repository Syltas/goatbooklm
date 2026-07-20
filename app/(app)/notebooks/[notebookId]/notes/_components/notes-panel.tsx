"use client"

import { ArrowLeft, NotebookPen, Plus } from "lucide-react"
import { forwardRef, useImperativeHandle, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { Note } from "@/lib/notes/service"

import { createNoteAction } from "../actions"
import { DeleteNoteDialog } from "./delete-note-dialog"
import { NoteEditor, type NoteEditorHandle } from "./note-editor"
import { NoteList } from "./note-list"

interface NotesPanelProps {
  notebookId: string
  /** Lifted to `notebook-detail-shell.tsx` (Bugfix Befund 6) — see
   *  `use-notes-state.ts`'s docstring for why, mirroring `SourcesPanel`'s
   *  `sources`/`onCreated`/`onDeleted` props. */
  notes: Note[]
  onCreated: (note: Note) => void
  onUpdated: (note: Note) => void
  onDeleted: (id: string) => void
}

/** Bugfix Befund 6 — lets `notebook-detail-shell.tsx` force the currently
 *  open note's pending autosave to run before unmounting the mobile Studio
 *  sheet's mount of this panel. A no-op (resolves immediately) whenever no
 *  note is open — nothing to flush in list view. */
export interface NotesPanelHandle {
  flush: () => Promise<void>
}

/**
 * Studio-Panel body for notes, mounted at both places
 * `notebook-detail-shell.tsx` renders the Studio panel (desktop panel +
 * mobile bottom-sheet). `notes` itself is lifted to the shell (Bugfix
 * Befund 6 — was independent per-mount state seeded from a shared
 * `initialNotes` PROP, so the two mounts silently diverged until the next
 * full server round trip); `openNoteId`/`deletingNote`/`creating` stay
 * local to each mount, same as `SourcesPanel`'s own `addDialogOpen`/
 * `deletingSource` — purely which-view-is-showing UI state, not data that
 * needs to survive a remount.
 */
export const NotesPanel = forwardRef<NotesPanelHandle, NotesPanelProps>(function NotesPanel(
  { notebookId, notes, onCreated, onUpdated, onDeleted },
  ref
) {
  const [creating, startCreateTransition] = useTransition()
  const [deletingNote, setDeletingNote] = useState<Note | null>(null)
  const [openNoteId, setOpenNoteId] = useState<string | null>(null)
  const editorRef = useRef<NoteEditorHandle>(null)

  useImperativeHandle(
    ref,
    () => ({
      flush: () => editorRef.current?.flush() ?? Promise.resolve(),
    }),
    []
  )

  const openNote = notes.find((note) => note.id === openNoteId) ?? null

  function handleCreate() {
    startCreateTransition(async () => {
      const result = await createNoteAction({ notebookId })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      onCreated(result.data)
    })
  }

  function handleDeleted(id: string) {
    onDeleted(id)
    setDeletingNote((current) => (current?.id === id ? null : current))
    // A note can be deleted straight from the list row while it's also the
    // currently open one — fall back to the list instead of leaving the
    // editor mounted for a note that no longer exists.
    setOpenNoteId((current) => (current === id ? null : current))
  }

  // Opened-note view: the editor is keyed on the note id (not just
  // rendered with `note={openNote}`) — `useEditor`'s `content` option is
  // only ever read on mount, so reusing one TipTap instance across two
  // different notes would keep showing the previously opened note's body
  // after switching. The `key` forces a full remount instead.
  if (openNote) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center border-b border-border px-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpenNoteId(null)}
            aria-label="Zurück zur Notizliste"
            data-test="notes-back-button"
          >
            <ArrowLeft className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <NoteEditor ref={editorRef} key={openNote.id} note={openNote} onUpdated={onUpdated} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 p-3">
        <Button
          type="button"
          variant="outline"
          className="h-[38px] w-full rounded-full border-border bg-transparent text-[14px] font-bold text-foreground hover:bg-secondary"
          onClick={handleCreate}
          disabled={creating}
          data-test="notes-add-button"
        >
          <Plus className="size-[15px]" /> Notiz hinzufügen
        </Button>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <span
            className="flex size-[52px] items-center justify-center rounded-full bg-secondary"
            aria-hidden="true"
          >
            <NotebookPen className="size-[22px] text-foreground" />
          </span>
          <p className="text-sm text-muted-foreground">
            Notizen sind dein persönlicher Platz für Gedanken,
            Zusammenfassungen und Ideen zu diesem Notizbuch.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-[38px] rounded-full border-border bg-transparent text-[14px] font-bold text-foreground hover:bg-secondary"
            onClick={handleCreate}
            disabled={creating}
            data-test="notes-empty-cta"
          >
            <Plus className="size-[15px]" /> Notiz hinzufügen
          </Button>
        </div>
      ) : (
        <NoteList
          notes={notes}
          onOpen={(note) => setOpenNoteId(note.id)}
          onUpdated={onUpdated}
          onDeleteRequest={setDeletingNote}
        />
      )}

      <DeleteNoteDialog
        note={deletingNote}
        onOpenChange={(open) => !open && setDeletingNote(null)}
        onDeleted={handleDeleted}
      />
    </div>
  )
})
