-- Per-document summaries for multi-granularity retrieval (chat-retrieval-rerank,
-- Phase 1). A short LLM-generated summary of each source, embedded with the SAME
-- model as chunks/queries (OpenAI text-embedding-3-small, 1536 dims), so an
-- overview/aggregation question ("worum geht es in den Quellen?") — which never
-- matches any single dense chunk well — can retrieve a doc-level candidate.
--
-- Stored as columns on `sources` (not as rows in `chunks`): one summary per doc,
-- naturally 1:1 with the source row, no chunk_index to invent. No new table, so
-- no new RLS/grants — the existing `sources_owner` policy + table grants
-- (create_core_schema.sql) already scope every column, new ones included.

alter table public.sources
  add column if not exists summary text,
  add column if not exists summary_embedding extensions.vector(1536);

-- HNSW cosine index, mirroring ix_chunks_embedding_hnsw. Partial (WHERE not
-- null) so the many rows without a summary yet (pre-backfill, or a source whose
-- summary generation failed) don't bloat the index.
create index if not exists ix_sources_summary_embedding_hnsw
  on public.sources using hnsw (summary_embedding extensions.vector_cosine_ops)
  where summary_embedding is not null;

-- ---------------------------------------------------------------------------
-- match_source_summaries — doc-level retrieval, mirrors match_chunks exactly
-- (security invoker + RLS, search_path = '', OPERATOR(extensions.<=>),
-- hnsw.iterative_scan). Deliberately NO p_min_similarity: the hard cosine gate
-- is being removed for chat retrieval (a broad overview query legitimately
-- scores low against every candidate) — the caller always takes the top-K and
-- lets rerank / the grounding prompt decide relevance.
-- ---------------------------------------------------------------------------

create or replace function public.match_source_summaries(
  p_notebook_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count int
)
returns table (
  source_id  uuid,
  title      text,
  summary    text,
  similarity float
)
language sql
stable
security invoker
set search_path = ''
set hnsw.iterative_scan = relaxed_order
as $$
  select
    s.id,
    s.title::text,
    s.summary,
    1 - (s.summary_embedding OPERATOR(extensions.<=>) p_query_embedding) as similarity
  from public.sources s
  where s.notebook_id = p_notebook_id
    and s.summary_embedding is not null
  order by s.summary_embedding OPERATOR(extensions.<=>) p_query_embedding asc
  limit greatest(p_match_count, 0)
$$;

revoke all on function public.match_source_summaries(uuid, extensions.vector, int) from public;
grant execute on function public.match_source_summaries(uuid, extensions.vector, int) to authenticated, service_role;
-- Same defense-in-depth as match_chunks: neutralize Postgres's implicit
-- default EXECUTE grant to `anon` — chat has no anonymous caller.
revoke execute on function public.match_source_summaries(uuid, extensions.vector, int) from anon;
