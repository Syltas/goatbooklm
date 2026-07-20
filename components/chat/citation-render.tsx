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
  h1: styled("h1", "mt-5 mb-2 text-[17px] font-semibold first:mt-0"),
  h2: styled("h2", "mt-5 mb-2 text-[16px] font-semibold first:mt-0"),
  h3: styled("h3", "mt-4 mb-1.5 text-[15px] font-semibold first:mt-0"),
  h4: styled("h4", "mt-4 mb-1.5 text-[15px] font-semibold first:mt-0"),
  ul: styled("ul", `${BLOCK} list-disc space-y-1 pl-5`),
  ol: styled("ol", `${BLOCK} list-decimal space-y-1 pl-5`),
  // A "loose" list wraps each item's text in a `<p>`; kill that margin so
  // list items don't get paragraph spacing between them.
  li: styled("li", "[&>p]:mb-0"),
  strong: styled("strong", "font-semibold"),
  hr: styled("hr", "my-4 border-[var(--border)]"),
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
export function CitationRender({ content, citations, onCite }: CitationRenderProps) {
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
        return <CitationChip citation={citation} onCite={onCite} />
      },
    }),
    [byN, onCite]
  )

  return (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
      {content}
    </Markdown>
  )
}
