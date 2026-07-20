"use client"

import { type ElementType, useMemo } from "react"
import Markdown, { type Components, type Options } from "react-markdown"
import remarkGfm from "remark-gfm"

import type { CitationDetail } from "@/lib/chat/types"

import { CitationChip, type OnCiteArgs } from "./citation-chip"
import { rehypeCitations } from "./rehype-citations"

type RehypePlugins = NonNullable<Options["rehypePlugins"]>

interface CitationRenderProps {
  content: string
  citations: CitationDetail[]
  onCite: (args: OnCiteArgs) => void
  /** Forwarded to every `CitationChip` as `hoverDisabled` — see that prop's
   *  docstring (`citation-chip.tsx`) for why a streaming message's chips
   *  must not open a hover-anchored card while they can still reflow. */
  isStreaming?: boolean
}

/** Block spacing: collapse the trailing margin so bubbles stay tight. */
const BLOCK = "mb-3 last:mb-0"

/**
 * react-markdown passes a `node` (the hast node) to every component. It must be
 * stripped before spreading onto a DOM element, otherwise React warns about an
 * unknown `node` prop — hence this factory instead of destructuring `node` in
 * eighteen separate arrow functions.
 */
function styled(Tag: ElementType, className: string) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return function Styled({ node, ...props }: { node?: unknown }) {
    return <Tag className={className} {...props} />
  }
}

const BASE_COMPONENTS = {
  p: styled("p", BLOCK),
  // Heading scale must stay strictly decreasing (h1 > h2 > h3 > h4) — a
  // model emitting `# Titel` followed by `## Abschnitt` must never render
  // the subsection larger than the title.
  h1: styled("h1", "mt-5 mb-2 text-[22px] font-semibold first:mt-0"),
  // H2 opens a new top-level section, so it carries a rule above it to
  // separate sections visually — without the model ever having to emit a
  // `---`. `first:` (same trick as h1/h3/h4 above/below) drops the rule and
  // its lead-in margin when the H2 is the message's very first block, so the
  // bubble doesn't open with a stray line.
  h2: styled(
    "h2",
    "mt-6 mb-2 border-t border-[var(--border)] pt-5 text-[20px] font-semibold first:mt-0 first:border-t-0 first:pt-0"
  ),
  h3: styled("h3", "mt-4 mb-1.5 text-[17px] font-semibold first:mt-0"),
  h4: styled("h4", "mt-4 mb-1.5 text-[15px] font-semibold first:mt-0"),
  ul: styled("ul", `${BLOCK} list-disc space-y-1 pl-5`),
  ol: styled("ol", `${BLOCK} list-decimal space-y-1 pl-5`),
  // A "loose" list wraps each item's text in a `<p>`; kill that margin so
  // list items don't get paragraph spacing between them.
  li: styled("li", "[&>p]:mb-0"),
  strong: styled("strong", "font-semibold"),
  // Models routinely emit `---` immediately before a `## ` section heading.
  // H2 already carries its own top rule (above), so without this an `<hr>`
  // directly followed by an `<h2>` stacks into two visible lines — the `hr`
  // already did the separating, so neutralize the H2's own
  // rule/margin/padding in exactly that adjacency via the `[&+h2]` sibling
  // variant (same arbitrary-variant mechanism as `[&>p]`/`[&>code]` below).
  hr: styled(
    "hr",
    "my-4 border-[var(--border)] [&+h2]:mt-0 [&+h2]:border-t-0 [&+h2]:pt-0"
  ),
  blockquote: styled(
    "blockquote",
    `${BLOCK} border-l-2 border-[var(--border)] pl-3 text-muted-foreground`
  ),
  code: styled("code", "rounded bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[13px]"),
  // The inner `<code>` inherits the fence's background, so neutralize the
  // inline-code styling above when it sits inside a `<pre>`.
  pre: styled(
    "pre",
    `${BLOCK} overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3 text-[13px] [&>code]:bg-transparent [&>code]:p-0`
  ),
  th: styled("th", "border border-[var(--border)] px-2 py-1 text-left font-semibold"),
  td: styled("td", "border border-[var(--border)] px-2 py-1 align-top"),

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a({ node, ...props }: { node?: unknown }) {
    return (
      <a
        className="text-[var(--action)] underline underline-offset-2"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    )
  },

  // Wide tables must scroll inside the bubble, never widen it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  table({ node, ...props }: { node?: unknown }) {
    return (
      <div className={`${BLOCK} overflow-x-auto`}>
        <table className="w-full border-collapse text-[14px]" {...props} />
      </div>
    )
  },
} satisfies Components

/**
 * Renders the assistant answer as GitHub-flavored markdown and replaces every
 * `[n]` marker that has a matching `CitationDetail` with a `CitationChip`
 * (§6 "Rendering der Antwort").
 *
 * Marker → chip happens in `rehypeCitations`, which inserts a
 * `<span data-citation-n>` placeholder into the hast tree; the `span`
 * component below swaps it for the chip. Server-side `parseCitations`
 * (`lib/chat/citations.ts`) already strips hallucinated markers before
 * persisting/streaming, so in practice every remaining `[n]` has a match —
 * unmatched ones stay raw text, which is also what the live-streaming window
 * before the `data-citations` part looks like (§3.1 step 4 "erscheinen
 * zunächst als roher Text").
 */
export function CitationRender({
  content,
  citations,
  onCite,
  isStreaming,
}: CitationRenderProps) {
  const byN = useMemo(
    () => new Map(citations.map((citation) => [citation.n, citation])),
    [citations]
  )

  const rehypePlugins = useMemo<RehypePlugins>(
    () => [[rehypeCitations, { valid: new Set(byN.keys()) }]],
    [byN]
  )

  const components = useMemo<Components>(
    () => ({
      ...BASE_COMPONENTS,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      span({ node, ...props }) {
        const n = (props as Record<string, unknown>)["data-citation-n"]
        if (typeof n !== "string") return <span {...props} />

        const citation = byN.get(Number(n))
        if (!citation) return null
        return <CitationChip citation={citation} onCite={onCite} hoverDisabled={isStreaming} />
      },
    }),
    [byN, onCite, isStreaming]
  )

  return (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
      {content}
    </Markdown>
  )
}
