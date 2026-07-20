"use client"

import Link from "@tiptap/extension-link"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { AlertCircle, Check, FileOutput, Loader2 } from "lucide-react"
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isNoteContentEmpty } from "@/lib/notes/convert-to-source"
import { toEditorContent } from "@/lib/notes/serialize"
import type { Note } from "@/lib/notes/service"
import { cn } from "@/lib/utils"

import { convertNoteToSourceAction, updateNoteAction } from "../actions"
import { NoteEditorToolbar } from "./note-editor-toolbar"
import { type NoteAutosaveStatus, useNoteAutosave } from "./use-note-autosave"

interface NoteEditorProps {
  note: Note
  onUpdated?: (note: Note) => void
}

/** Bugfix Befund 6 — imperative handle so `notes-panel.tsx` (and, through
 *  it, `notebook-detail-shell.tsx`) can force a still-pending autosave to
 *  run before unmounting this editor (mobile Studio sheet close). Not a
 *  prop/state signal: the close action and the unmount it triggers can land
 *  in the same React commit, too late for a normal render-driven effect to
 *  react to before the tree is torn down — see `useNoteAutosave`'s `flush`
 *  docstring for the full "why". */
export interface NoteEditorHandle {
  flush: () => Promise<void>
}

/**
 * Styling for the rendered document, expressed as descendant selectors on
 * the contenteditable root — StarterKit's nodes (h1–h3, ul/ol/li,
 * blockquote, pre/code, hr, a) render as plain unstyled elements
 * otherwise (Tailwind's preflight strips default UA styles), and this
 * can't live in `app/globals.css` (owned by the in-flight redesign right
 * now). Colors only ever reference existing tokens — no hex — per project
 * convention.
 */
const NOTE_CONTENT_CLASS = cn(
  "min-h-40 flex-1 px-3 py-2 text-sm text-foreground outline-none",
  "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-xl [&_h1]:font-bold",
  "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-lg [&_h2]:font-bold",
  "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-bold",
  "[&_p]:my-1",
  "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-secondary [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs",
  "[&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:my-3 [&_hr]:border-border",
  "[&_a]:text-primary [&_a]:underline"
)

/**
 * Opened-note view: title field + TipTap body, autosaved (see
 * `useNoteAutosave`). Mounted by `notes-panel.tsx` with `key={note.id}` —
 * `useEditor`'s `content` option is only ever read once, on mount, so
 * without that key switching from one open note to another would keep
 * showing the previous note's body in the same TipTap instance instead of
 * remounting with the new one's content.
 */
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { note, onUpdated },
  ref
) {
  const [title, setTitle] = useState(note.title)
  const [contentRevision, setContentRevision] = useState(0)
  const [converting, setConverting] = useState(false)

  const editor = useEditor({
    // Required in the Next.js App Router: the server never renders
    // TipTap's DOM, so rendering it immediately on the client would
    // produce a markup mismatch against the (empty) server-rendered
    // output. TipTap then renders once, after mount, instead.
    immediatelyRender: false,
    extensions: [
      // Link is registered explicitly below (its own dependency, its own
      // config) rather than via StarterKit's bundled default.
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false, // inside an editor, clicking a link should place the cursor, not navigate away
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
    ],
    content: toEditorContent(note.content),
    onUpdate: () => setContentRevision((revision) => revision + 1),
    editorProps: {
      attributes: {
        class: NOTE_CONTENT_CLASS,
        "data-test": "note-editor-content",
      },
    },
  })

  const { status, errorMessage, retry, flush } = useNoteAutosave({
    noteId: note.id,
    editor,
    title,
    contentRevision,
    onSaved: onUpdated,
  })

  useImperativeHandle(ref, () => ({ flush }), [flush])

  // A note refreshed from outside this component (e.g. a server
  // re-render after some other mutation's `revalidatePath`) may carry a
  // title changed elsewhere — keep the field in sync, same pattern as
  // `NoteListItem`.
  useEffect(() => {
    setTitle(note.title)
  }, [note.title])

  // Recomputed only when the document actually changes (`contentRevision`,
  // bumped by TipTap's `onUpdate`) — not on every render — so the "Zu
  // Quelle machen" button disables itself live while typing, not just once
  // on mount (task 4: a freshly-created note is a paragraph shell, not
  // `""`, so this has to go through the same plaintext projection the
  // conversion itself uses, not a naive content-JSON truthiness check).
  const isEmpty = useMemo(
    () => !editor || isNoteContentEmpty(editor.getJSON()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contentRevision is the real change signal; editor itself is stable after mount.
    [editor, contentRevision]
  )

  async function handleConvertToSource() {
    if (!editor || converting) return

    setConverting(true)
    try {
      // Flush the latest edit first: `convertNoteToSourceAction` reads
      // `notes.content` straight from the DB, but the debounced autosave
      // (`useNoteAutosave`, 800ms) may not have persisted the user's most
      // recent keystrokes yet by the time this click happens. Reuses
      // `updateNoteAction` directly rather than the autosave hook's own
      // internal `save` (not exposed as an awaitable), so this can wait
      // for the write to land before converting whatever is now in the DB.
      const trimmedTitle = title.trim()
      const flushed = await updateNoteAction({
        id: note.id,
        ...(trimmedTitle.length > 0 ? { title: trimmedTitle } : {}),
        // `structuredClone`, not `editor.getJSON()` directly — see
        // `useNoteAutosave`'s identical comment on why a Server Action
        // argument needs its own, non-shared object references.
        content: structuredClone(editor.getJSON()),
      })
      if ("error" in flushed) {
        toast.error(flushed.error)
        return
      }
      onUpdated?.(flushed.data)

      const result = await convertNoteToSourceAction({ id: note.id })
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success(`„${result.data.title}“ wurde als Quelle hinzugefügt.`)
    } finally {
      setConverting(false)
    }
  }

  return (
    <div className="flex h-full flex-col" data-test="note-editor">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Notiztitel"
          className="h-8 flex-1 border-transparent bg-transparent px-1 text-base font-bold text-foreground hover:border-border focus-visible:border-border"
          data-test="note-editor-title-input"
        />
        <SaveStatus status={status} errorMessage={errorMessage} onRetry={retry} />
      </div>

      <NoteEditorToolbar editor={editor} />

      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleConvertToSource}
          disabled={isEmpty || converting}
          title={
            isEmpty
              ? "Leere Notizen können nicht zu einer Quelle gemacht werden."
              : undefined
          }
          data-test="note-convert-to-source-button"
        >
          {converting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileOutput className="size-3.5" />
          )}
          Zu Quelle machen
        </Button>
      </div>
    </div>
  )
})

interface SaveStatusProps {
  status: NoteAutosaveStatus
  errorMessage: string | null
  onRetry: () => void
}

/** Visible "gespeichert…"/"speichert" state is the whole point of
 *  autosave without a save button — and the error branch is the one that
 *  actually matters: a silent autosave failure is worse than no autosave,
 *  so it gets its own visible, clickable-to-retry state rather than
 *  quietly falling back to "gespeichert" or "idle". */
function SaveStatus({ status, errorMessage, onRetry }: SaveStatusProps) {
  if (status === "idle") return null

  if (status === "saving") {
    return (
      <span
        className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
        data-test="note-editor-save-status"
        data-status="saving"
      >
        <Loader2 className="size-3 animate-spin" /> speichert…
      </span>
    )
  }

  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex shrink-0 items-center gap-1 text-xs text-destructive underline-offset-2 hover:underline"
        title={errorMessage ?? undefined}
        data-test="note-editor-save-status"
        data-status="error"
      >
        <AlertCircle className="size-3" /> Nicht gespeichert — erneut versuchen
      </button>
    )
  }

  return (
    <span
      className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
      data-test="note-editor-save-status"
      data-status="saved"
    >
      <Check className="size-3" /> gespeichert
    </span>
  )
}
