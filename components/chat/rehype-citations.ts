import type { Element, Root, RootContent, Text } from "hast"

const MARKER = /\[(\d+)\]/g

/** Markers inside code spans/blocks are literal text, never citations. */
const OPAQUE_TAGS = new Set(["code", "pre"])

/**
 * Rehype plugin that turns every `[n]` marker with a matching citation into a
 * `<span data-citation-n="n">` placeholder element, which `CitationRender`
 * maps to a `CitationChip` via react-markdown's `components` prop.
 *
 * It runs on the **hast** tree, i.e. *after* markdown block parsing — that is
 * the whole point. Splitting the raw string on `[n]` first (what the previous
 * renderer did) destroys block structure: a marker sitting inside a list item
 * or heading would tear the source text into fragments that no longer parse as
 * markdown. Here the headings/lists/tables already exist as elements, and the
 * chip is inserted into whatever inline position it belongs to.
 */
export function rehypeCitations({ valid }: { valid: Set<number> }) {
  return function transformer(tree: Root) {
    walk(tree)
  }

  function walk(node: Root | Element): void {
    if (node.type === "element" && OPAQUE_TAGS.has(node.tagName)) return

    const next: RootContent[] = []
    let changed = false

    for (const child of node.children) {
      if (child.type === "text") {
        const parts = splitMarkers(child)
        if (parts) {
          next.push(...parts)
          changed = true
          continue
        }
      } else if (child.type === "element") {
        walk(child)
      }
      next.push(child)
    }

    if (changed) (node as { children: RootContent[] }).children = next
  }

  function splitMarkers(node: Text): RootContent[] | null {
    const { value } = node
    const out: RootContent[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    MARKER.lastIndex = 0
    while ((match = MARKER.exec(value)) !== null) {
      const n = Number(match[1])
      // An unknown `[n]` stays literal text — same contract as the server-side
      // `parseCitations`, and it covers the streaming window before the
      // `data-citations` part has arrived.
      if (!valid.has(n)) continue

      if (match.index > lastIndex) {
        out.push({ type: "text", value: value.slice(lastIndex, match.index) })
      }
      out.push({
        type: "element",
        tagName: "span",
        properties: { dataCitationN: String(n) },
        children: [],
      })
      lastIndex = match.index + match[0].length
    }

    if (out.length === 0) return null
    if (lastIndex < value.length) out.push({ type: "text", value: value.slice(lastIndex) })
    return out
  }
}
