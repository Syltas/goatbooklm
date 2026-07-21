"use client"

import { MoreVertical, NotebookPen, Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Note } from "@/lib/notes/service"

const noteDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "long",
  year: "numeric",
})

function formatNoteDate(iso: string): string {
  return noteDateFormatter.format(new Date(iso))
}

interface NoteListItemProps {
  note: Note
  onOpen: (note: Note) => void
  onRenameRequest: (note: Note) => void
  onDeleteRequest: (note: Note) => void
}

/**
 * Studio-Merge: rendered inline in the Studio panel's ONE combined list next
 * to the artifact rows (`studio-panel.tsx`), so the row chrome mirrors
 * `artifact-row-<id>` there — leading icon, static title + subtitle, and a
 * trailing ⋮ kebab menu — not the old rounded card, so it reads as a single
 * cohesive stream.
 *
 * Kebab parity (specs-v2-fixes-2.md §6): this used to render the title as a
 * live, always-editable `Input` that saved on blur, with a direct trash
 * `Button` next to it — the ONE thing that visually/functionally set note
 * rows apart from artifact rows in the mixed list. Both are gone now: the
 * title is a static label (exactly like `artifact-row-<id>`'s `<p>`), and
 * "Umbenennen"/"Löschen" both live behind the SAME `DropdownMenu` idiom
 * `artifactMenu()` uses in `studio-panel.tsx` (down to the icon choices and
 * `data-test` naming: `note-menu-<id>` / `note-menu-rename` /
 * `note-menu-delete`, mirroring `artifact-menu-<id>` / `artifact-menu-rename`
 * / `artifact-menu-delete`). "Umbenennen" opens `RenameNoteDialog` (mirrors
 * `RenameArtifactDialog`) via `onRenameRequest`; "Löschen" opens the
 * pre-existing `DeleteNoteDialog` via `onDeleteRequest` — both dialogs are
 * mounted once by `studio-panel.tsx`, not per-row, same as the artifact
 * dialogs.
 *
 * The row itself still opens the note on click; the trailing menu column
 * `stopPropagation`s (on both the wrapping div and the trigger button, same
 * belt-and-suspenders the artifact row uses) so opening/using the menu never
 * also opens the note underneath it.
 */
export function NoteListItem({
  note,
  onOpen,
  onRenameRequest,
  onDeleteRequest,
}: NoteListItemProps) {
  return (
    <div
      className="flex cursor-pointer items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted/40"
      onClick={() => onOpen(note)}
      data-test={`note-row-${note.id}`}
    >
      <NotebookPen
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-foreground"
          data-test={`note-title-${note.id}`}
        >
          {note.title}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Zuletzt bearbeitet am {formatNoteDate(note.updated_at)}
        </p>
      </div>
      <div
        className="flex shrink-0 items-center gap-0.5"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={(event) => event.stopPropagation()}
              aria-label={`Optionen für „${note.title}“`}
              data-test={`note-menu-${note.id}`}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              data-test="note-menu-rename"
              onSelect={() => onRenameRequest(note)}
            >
              <Pencil /> Umbenennen
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              data-test="note-menu-delete"
              onSelect={() => onDeleteRequest(note)}
            >
              <Trash2 /> Löschen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
