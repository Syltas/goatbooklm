"use client"

import type { ElementType } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Markdown-Renderer für Report-Dokumente. Bewusst eine EIGENE schlanke
 * Kopie der Chat-Styles (`components/chat/citation-render.tsx`) statt
 * eines Exports von dort: die Chat-Datei wird parallel von der
 * core-loop-v2-Session umgebaut — sie anzufassen wäre unnötige
 * Merge-Konfliktfläche (Spec Premise 5). Reports haben zudem kein
 * Citation-Rehype und etwas großzügigere Dokument-Typografie.
 */

const BLOCK = "mb-3 last:mb-0"

function styled(Tag: ElementType, className: string) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return function Styled({ node, ...props }: { node?: unknown }) {
    return <Tag className={className} {...props} />
  }
}

const COMPONENTS = {
  p: styled("p", BLOCK),
  h1: styled("h1", "mt-6 mb-2.5 text-[19px] font-semibold first:mt-0"),
  h2: styled("h2", "mt-6 mb-2 text-[17px] font-semibold first:mt-0"),
  h3: styled("h3", "mt-4 mb-1.5 text-[15px] font-semibold first:mt-0"),
  h4: styled("h4", "mt-4 mb-1.5 text-[15px] font-semibold first:mt-0"),
  ul: styled("ul", `${BLOCK} list-disc space-y-1 pl-5`),
  ol: styled("ol", `${BLOCK} list-decimal space-y-1 pl-5`),
  li: styled("li", "[&>p]:mb-0"),
  strong: styled("strong", "font-semibold"),
  hr: styled("hr", "my-4 border-[var(--border)]"),
  blockquote: styled(
    "blockquote",
    `${BLOCK} border-l-2 border-[var(--border)] pl-3 text-muted-foreground`
  ),
  code: styled("code", "rounded bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[13px]"),
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  table({ node, ...props }: { node?: unknown }) {
    return (
      <div className={`${BLOCK} overflow-x-auto`}>
        <table className="w-full border-collapse text-[14px]" {...props} />
      </div>
    )
  },
}

export function ReportMarkdown({ content }: { content: string }) {
  return (
    <div className="text-[15px] leading-[1.65] text-foreground">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </Markdown>
    </div>
  )
}
