import type { CitationDetail } from "@/lib/chat/types"

import { CitationChip, type OnCiteArgs } from "./citation-chip"

const MARKER = /\[(\d+)\]/g

interface CitationRenderProps {
  content: string
  citations: CitationDetail[]
  onCite: (args: OnCiteArgs) => void
}

/**
 * Splits `content` at `[n]`-marker boundaries and replaces every marker that
 * has a matching `CitationDetail` with a `CitationChip` (§6 "Rendering der
 * Antwort"). Server-side `parseCitations` (`lib/chat/citations.ts`) already
 * strips every hallucinated marker before persisting/streaming, so in
 * practice every remaining `[n]` here has a match — the `citations.length
 * === 0` short-circuit below also covers the live-streaming window before
 * the `data-citations` part has arrived (raw `[n]` text renders as-is,
 * matching §3.1 step 4 "erscheinen zunächst als roher Text").
 */
export function CitationRender({ content, citations, onCite }: CitationRenderProps) {
  if (citations.length === 0) return <>{content}</>

  const byN = new Map(citations.map((citation) => [citation.n, citation]))
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  MARKER.lastIndex = 0
  while ((match = MARKER.exec(content)) !== null) {
    const n = Number(match[1])
    const citation = byN.get(n)
    if (!citation) continue

    nodes.push(content.slice(lastIndex, match.index))
    nodes.push(<CitationChip key={`${match.index}-${n}`} citation={citation} onCite={onCite} />)
    lastIndex = match.index + match[0].length
  }
  nodes.push(content.slice(lastIndex))

  return <>{nodes}</>
}
