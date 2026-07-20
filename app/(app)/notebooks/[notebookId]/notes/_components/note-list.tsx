"use client"

import type { Note } from "@/lib/notes/service"

import { NoteListItem } from "./note-list-item"

interface NoteListProps {
  notes: Note[]
  onOpen: (note: Note) => void
  onUpdated: (note: Note) => void
  onDeleteRequest: (note: Note) => void
}

export function NoteList({ notes, onOpen, onUpdated, onDeleteRequest }: NoteListProps) {
  return (
    <div
      className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2"
      data-test="note-list"
    >
      {notes.map((note) => (
        <NoteListItem
          key={note.id}
          note={note}
          onOpen={onOpen}
          onUpdated={onUpdated}
          onDeleteRequest={onDeleteRequest}
        />
      ))}
    </div>
  )
}
