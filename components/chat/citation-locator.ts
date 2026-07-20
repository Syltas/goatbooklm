import type { CitationDetail } from "@/lib/chat/types"

/**
 * "Seite 2 · Absatz 1"-style locator (Design-Review 2026-07-20 §Teil 1) —
 * degrades field-by-field instead of interpolating `undefined` into the
 * string: a web/text/note citation has no `page` (only PDFs paginate, see
 * `buildChunkMetadata`, `lib/ingestion/service.ts`) and must never render
 * "Seite undefined". Returns `null` (render nothing) only in the
 * theoretical case where even `paragraph` is missing (a hallucinated-marker
 * edge case `parseCitations` already filters out in practice).
 *
 * Plain `.ts` (no JSX) on purpose, same as `rehype-citations.ts` — the
 * project's `vitest.config.ts` is a service-layer, `environment: "node"`
 * config with no JSX transform wired up for `.tsx` component files, so a
 * pure formatting helper needs to live outside `citation-popover.tsx` to
 * stay unit-testable under the existing `pnpm test` setup.
 */
export function formatLocator(citation: CitationDetail): string | null {
  const { page, paragraph } = citation
  if (page != null && paragraph != null) return `Seite ${page} · Absatz ${paragraph}`
  if (paragraph != null) return `Absatz ${paragraph}`
  if (page != null) return `Seite ${page}`
  return null
}
