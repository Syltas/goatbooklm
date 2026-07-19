import type { Source } from "@/lib/ingestion/service"

/**
 * A `sources` row with its chunk count attached via one grouped Supabase
 * query (`sources.select("*, chunks(count)")`, AC-43/F12) — never N
 * per-source count queries. `chunks` is always a one-element array (or
 * empty before the embed resolves) per PostgREST's `count()`-on-embed
 * convention.
 */
export type SourceWithChunkCount = Source & { chunks: { count: number }[] }

export function getChunkCount(source: SourceWithChunkCount): number {
  return source.chunks?.[0]?.count ?? 0
}
