import type { JSONContent } from "@tiptap/react"

/**
 * TipTap-JSON <-> plaintext, in both directions. Shared infrastructure for
 * three follow-up features that each only need one direction: "Notiz zu
 * Quelle machen" needs plaintext for the ingestion/embedding pipeline
 * (JSON -> text), "Als Notiz speichern" from a chat answer or the
 * notebook summary needs the reverse (text -> JSON, so the result is a
 * valid `notes.content`). Neither direction is lossless — plaintext has no
 * marks or block types — that's expected: this is a projection for
 * machine consumption, not a round-trip format. Framework-agnostic on
 * purpose (no "use client"): callers on both the server (ingestion) and
 * the client (chat, summary) import the same functions. The only import
 * from `@tiptap/react` is the `JSONContent` type, which is erased at
 * build time — no React/editor runtime code ends up in a server bundle
 * that imports this module.
 */

/**
 * What a brand-new note's `content` looks like once opened in the editor —
 * mirrors what `editor.getJSON()` returns for a blank TipTap document (one
 * empty paragraph). NOT the same as the DB column's literal default
 * (`'{}'::jsonb`, see the migration) — `{}` is not a valid ProseMirror doc
 * and would make `editor.commands.setContent` throw if handed to it
 * as-is; `toEditorContent` below is exactly the translation between the
 * two.
 */
export const EMPTY_NOTE_CONTENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
}

function isUsableDoc(value: unknown): value is JSONContent {
  if (typeof value !== "object" || value === null) return false
  const doc = value as JSONContent
  return doc.type === "doc" && Array.isArray(doc.content) && doc.content.length > 0
}

/**
 * Normalizes whatever is stored in `notes.content` into something safe to
 * pass as TipTap's `content` option. Every note row is created with the
 * DB default (`{}`, see the migration) and only gets a real document once
 * it's opened in the editor and autosaved for the first time — without
 * this, every call site opening a note would need its own `{}` guard.
 */
export function toEditorContent(value: unknown): JSONContent {
  return isUsableDoc(value) ? value : EMPTY_NOTE_CONTENT
}

const LIST_INDENT = "  "

function linkHrefOf(node: JSONContent): string | undefined {
  const link = node.marks?.find((mark) => mark.type === "link")
  const href = link?.attrs?.href
  return typeof href === "string" ? href : undefined
}

/**
 * Renders one inline text node. A link mark is the one piece of a mark
 * that's actually lossy to drop silently in plaintext (bold/italic/code
 * just vanish, which is fine — the visible text is unchanged; a link's
 * destination is not visible text at all), so its href is appended in
 * parentheses — unless the visible text already *is* the href, which is
 * what an autolinked bare URL looks like and would otherwise double up.
 */
function renderText(node: JSONContent): string {
  const text = node.text ?? ""
  const href = linkHrefOf(node)
  if (href && href !== text) return `${text} (${href})`
  return text
}

function renderInline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return ""
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "\n"
      if (node.type === "text") return renderText(node)
      // Defensive fallback for any inline node type this serializer
      // doesn't know about yet — recurse into its children rather than
      // dropping it silently.
      return renderInline(node.content)
    })
    .join("")
}

function renderList(node: JSONContent, ordered: boolean, depth: number): string {
  const items = node.content ?? []
  const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1

  return items
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- "
      const indent = LIST_INDENT.repeat(depth)

      // A list item's own content is itself a sequence of blocks —
      // typically one paragraph, but a nested list is StarterKit's way of
      // representing "child items" (the nested <ul>/<ol> lives *inside*
      // the parent <li>, one level deeper). Only the first rendered line
      // gets the marker; everything else (including nested-list lines,
      // already indented one level further by the recursive call) is
      // appended below it as-is.
      const lines = (item.content ?? [])
        .map((child) => renderBlock(child, depth + 1))
        .filter((line) => line.length > 0)

      const [first, ...rest] = lines
      return [`${indent}${marker}${first ?? ""}`, ...rest].join("\n")
    })
    .join("\n")
}

function renderBlock(node: JSONContent, depth = 0): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return renderInline(node.content)
    case "codeBlock":
      // Code content is stored as plain text with real `\n` characters
      // (unlike paragraphs, which need `hardBreak` nodes) — rendering it
      // verbatim already preserves internal line breaks.
      return renderInline(node.content)
    case "blockquote":
      return (node.content ?? [])
        .map((child) => renderBlock(child, depth))
        .join("\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")
    case "bulletList":
      return renderList(node, false, depth)
    case "orderedList":
      return renderList(node, true, depth)
    case "horizontalRule":
      return "---"
    default:
      // Unknown block type: render its children rather than lose the text
      // inside it outright.
      return node.content ? renderInline(node.content) : ""
  }
}

/**
 * TipTap JSON -> plaintext. Top-level blocks are separated by a blank
 * line (markdown-ish, but this is not markdown — no escaping, no fences).
 * Anything that isn't a real ProseMirror doc (the DB default `{}`,
 * `null`, garbage) becomes `""` rather than throwing — a note that was
 * never opened in the editor still has *some* text representation.
 */
export function noteContentToPlainText(content: unknown): string {
  if (typeof content !== "object" || content === null) return ""
  const doc = content as JSONContent

  return (doc.content ?? [])
    .map((node) => renderBlock(node))
    .filter((block) => block.length > 0)
    .join("\n\n")
    .trim()
}

/**
 * Plaintext -> TipTap JSON. The inverse projection used when a chat
 * answer or the notebook summary is saved as a note. Blank-line-separated
 * chunks become paragraphs; single newlines inside a chunk become hard
 * breaks. Deliberately does NOT try to reconstruct lists, headings, code
 * blocks or links from plaintext — none of that survived the forward
 * direction either, so a line that happens to start with "- " or contain
 * a URL stays exactly the text it is.
 */
export function plainTextToNoteContent(text: string): JSONContent {
  const trimmed = text.trim()
  if (trimmed.length === 0) return EMPTY_NOTE_CONTENT

  const paragraphs = trimmed.split(/\n{2,}/).map((chunk) => chunk.split("\n"))

  return {
    type: "doc",
    content: paragraphs.map((lines) => {
      const inline = lines.flatMap((line, index) => {
        const nodes: JSONContent[] = []
        if (index > 0) nodes.push({ type: "hardBreak" })
        if (line.length > 0) nodes.push({ type: "text", text: line })
        return nodes
      })
      // Matches what `editor.getJSON()` actually produces for an empty
      // paragraph (no `content` key at all, not `content: []`).
      return inline.length > 0 ? { type: "paragraph", content: inline } : { type: "paragraph" }
    }),
  }
}
