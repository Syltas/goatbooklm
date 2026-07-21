"use client"

import { type Editor, useEditorState } from "@tiptap/react"
import {
  Bold,
  ChevronDown,
  Code,
  Code2,
  Eraser,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react"
import { type ComponentType, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface NoteEditorToolbarProps {
  editor: Editor | null
}

const HEADING_LEVELS = [1, 2, 3] as const
type HeadingLevel = 0 | (typeof HEADING_LEVELS)[number]

const HEADING_LABELS: Record<HeadingLevel, string> = {
  0: "Normal",
  1: "Überschrift 1",
  2: "Überschrift 2",
  3: "Überschrift 3",
}

/**
 * Toolbar for the note editor — exactly the 13 elements the reference UI
 * shows: Undo, Redo, Textgröße, Bold, Italic, Link, Code, Codeblock,
 * Bullet-List, Ordered-List, Quote, Divider, Clear-Formatting.
 * "Textgröße" is heading level (Normal/H1/H2/H3), not pixel font size —
 * StarterKit's `Heading` extension already gives us that for free, no
 * separate font-size extension needed.
 *
 * Active state is read via `useEditorState` (TipTap v3's recommended
 * selector hook) rather than forcing a re-render on every transaction —
 * the editor mutates in place, so without subscribing here the toolbar
 * would never show e.g. "Bold" as pressed while the cursor sits in bold
 * text.
 *
 * Grouped with dividers and left to wrap (`flex-wrap`) rather than scroll
 * horizontally — this renders in a ~250–400px Studio panel, too narrow
 * for 13 elements on one line.
 */
export function NoteEditorToolbar({ editor }: NoteEditorToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
      headingLevel: (HEADING_LEVELS.find((level) => e?.isActive("heading", { level })) ??
        0) as HeadingLevel,
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      link: e?.isActive("link") ?? false,
      code: e?.isActive("code") ?? false,
      codeBlock: e?.isActive("codeBlock") ?? false,
      bulletList: e?.isActive("bulletList") ?? false,
      orderedList: e?.isActive("orderedList") ?? false,
      blockquote: e?.isActive("blockquote") ?? false,
    }),
  })

  if (!editor || !state) return null

  return (
    <div className="border-b border-border p-1.5" data-test="note-editor-toolbar">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-0.5">
        <ToolbarButton
          label="Rückgängig"
          icon={Undo2}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!state.canUndo}
          dataTest="note-toolbar-undo"
        />
        <ToolbarButton
          label="Wiederholen"
          icon={Redo2}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!state.canRedo}
          dataTest="note-toolbar-redo"
        />

        <ToolbarDivider />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 px-2 text-xs"
              data-test="note-toolbar-heading"
            >
              {HEADING_LABELS[state.headingLevel]}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => editor.chain().focus().setParagraph().run()}
              className={cn(state.headingLevel === 0 && "bg-accent")}
              data-test="note-toolbar-heading-normal"
            >
              Normal
            </DropdownMenuItem>
            {HEADING_LEVELS.map((level) => (
              <DropdownMenuItem
                key={level}
                onSelect={() => editor.chain().focus().toggleHeading({ level }).run()}
                className={cn(state.headingLevel === level && "bg-accent")}
                data-test={`note-toolbar-heading-${level}`}
              >
                Überschrift {level}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolbarDivider />

        <ToolbarButton
          label="Fett"
          icon={Bold}
          active={state.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
          dataTest="note-toolbar-bold"
        />
        <ToolbarButton
          label="Kursiv"
          icon={Italic}
          active={state.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          dataTest="note-toolbar-italic"
        />
        <LinkToolbarButton editor={editor} active={state.link} />
        <ToolbarButton
          label="Code"
          icon={Code}
          active={state.code}
          onClick={() => editor.chain().focus().toggleCode().run()}
          dataTest="note-toolbar-code"
        />

        <ToolbarDivider />

        <ToolbarButton
          label="Codeblock"
          icon={Code2}
          active={state.codeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          dataTest="note-toolbar-codeblock"
        />
        <ToolbarButton
          label="Aufzählungsliste"
          icon={List}
          active={state.bulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          dataTest="note-toolbar-bullet-list"
        />
        <ToolbarButton
          label="Nummerierte Liste"
          icon={ListOrdered}
          active={state.orderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          dataTest="note-toolbar-ordered-list"
        />
        <ToolbarButton
          label="Zitat"
          icon={Quote}
          active={state.blockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          dataTest="note-toolbar-quote"
        />
        <ToolbarButton
          label="Trennlinie"
          icon={Minus}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          dataTest="note-toolbar-divider"
        />

        <ToolbarDivider />

        <ToolbarButton
          label="Formatierung entfernen"
          icon={Eraser}
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          dataTest="note-toolbar-clear-formatting"
        />
      </div>
    </div>
  )
}

function ToolbarDivider() {
  return <div className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
}

interface ToolbarButtonProps {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  active?: boolean
  disabled?: boolean
  dataTest: string
}

function ToolbarButton({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
  dataTest,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(active && "bg-secondary text-foreground")}
      data-test={dataTest}
    >
      <Icon className="size-3.5" />
    </Button>
  )
}

/** Its own popover rather than a plain button — applying a link needs a
 *  place to type the URL, unlike every other mark/node toggle in this
 *  toolbar which needs no extra input. */
function LinkToolbarButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState("")

  function handleOpenChange(next: boolean) {
    if (next) {
      // Pre-fill with the current link's href when the cursor sits inside
      // one, so re-opening the popover to edit a link doesn't force
      // retyping it from scratch.
      const attrs = editor.getAttributes("link")
      setHref(typeof attrs.href === "string" ? attrs.href : "")
    }
    setOpen(next)
  }

  function applyLink() {
    const trimmed = href.trim()
    if (trimmed.length === 0) return
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run()
    setOpen(false)
  }

  function removeLink() {
    editor.chain().focus().unsetLink().run()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Link"
          aria-pressed={active}
          title="Link"
          className={cn(active && "bg-secondary text-foreground")}
          data-test="note-toolbar-link"
        >
          <Link2 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <div className="flex flex-col gap-2">
          <Input
            value={href}
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                applyLink()
              }
            }}
            placeholder="https://…"
            aria-label="Link-URL"
            data-test="note-toolbar-link-input"
          />
          <div className="flex justify-end gap-1.5">
            {active && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={removeLink}
                data-test="note-toolbar-link-remove"
              >
                Entfernen
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={applyLink}
              data-test="note-toolbar-link-apply"
            >
              Anwenden
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
