-- match_chunks RPC for chat grounding (Spec 03, §3.4, Contract 1).
-- Retrieval over pgvector for a single notebook. security invoker so the
-- existing chunks_owner RLS policy filters rows — a foreign notebook_id
-- yields 0 rows instead of another user's chunks.

-- ---------------------------------------------------------------------------
-- AC-42 (F1): guard against pgvector < 0.8.0 — hnsw.iterative_scan
-- (relaxed_order) used below does not exist before 0.8.0.
-- ---------------------------------------------------------------------------

do $$
declare
  v_version text;
  v_major int;
  v_minor int;
begin
  select extversion into v_version from pg_extension where extname = 'vector';

  if v_version is null then
    raise exception 'pgvector extension is not installed. Install pgvector >= 0.8.0 before applying this migration (required for hnsw.iterative_scan).';
  end if;

  v_major := split_part(v_version, '.', 1)::int;
  v_minor := split_part(v_version, '.', 2)::int;

  if v_major = 0 and v_minor < 8 then
    raise exception 'pgvector version % is too old (found via pg_extension.extversion). hnsw.iterative_scan requires pgvector >= 0.8.0. Run "alter extension vector update" (or upgrade the extension package) before applying this migration.', v_version;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- match_chunks
-- ---------------------------------------------------------------------------

create or replace function public.match_chunks(
  p_notebook_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count int,
  p_min_similarity float
)
returns table (
  chunk_id    uuid,
  source_id   uuid,
  content     text,
  chunk_index int,
  similarity  float,
  metadata    jsonb
)
language sql
stable
security invoker            -- RLS applies: caller only sees their own chunks. NEVER security definer.
set search_path = ''
set hnsw.iterative_scan = relaxed_order   -- (Eng-Review 2026-07-19, F1) avoid short-return under WHERE post-filter
as $$
  -- NOTE: with search_path = '' the pgvector <=> operator (installed in the
  -- extensions schema, not pg_catalog) is not resolvable unqualified — it
  -- must be schema-qualified via OPERATOR(extensions.<=>). Semantics are
  -- identical to the plain <=> used in the spec contract.
  select
    c.id,
    c.source_id,
    c.content,
    c.chunk_index,
    1 - (c.embedding OPERATOR(extensions.<=>) p_query_embedding) as similarity,
    c.metadata
  from public.chunks c
  where c.notebook_id = p_notebook_id
    and c.embedding is not null
    and 1 - (c.embedding OPERATOR(extensions.<=>) p_query_embedding) >= p_min_similarity
  order by c.embedding OPERATOR(extensions.<=>) p_query_embedding asc
  limit greatest(p_match_count, 0)
$$;

revoke all on function public.match_chunks(uuid, extensions.vector, int, float) from public;
grant execute on function public.match_chunks(uuid, extensions.vector, int, float) to authenticated, service_role;

-- Defense-in-depth (Spec 03 task brief): Postgres/Supabase grants EXECUTE on
-- newly created functions in the `public` schema to `anon` via its own
-- `alter default privileges` setup, independent of the `revoke all ... from
-- public` above (that revoke undoes the implicit PUBLIC-pseudo-role grant,
-- not a role-specific default-privilege grant to `anon`). `chat-grounding`
-- has no anonymous/unauthenticated caller at all — neutralize the default
-- grant explicitly so an anonymous request can never even reach the
-- `security invoker`/RLS layer.
revoke execute on function public.match_chunks(uuid, extensions.vector, int, float) from anon;
