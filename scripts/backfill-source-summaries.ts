/**
 * One-off backfill: generate + embed a per-doc summary for every existing
 * `ready` source that has none yet (chat-retrieval-rerank Phase 1). New
 * uploads get their summary during ingestion (`lib/ingestion/service.ts`);
 * this covers rows that were already `ready` before the feature shipped.
 *
 * Idempotent + resumable: only touches sources WHERE status='ready' AND
 * summary IS NULL, so re-running it skips everything already done and picks up
 * where a previous interrupted run left off.
 *
 * Run (loads .env.local for the target Supabase — point it at LOCAL or PROD by
 * whatever that file contains):
 *   node scripts/backfill-source-summaries.ts          # do it
 *   node scripts/backfill-source-summaries.ts --dry-run # just count
 *
 * Reuses the exact production summary model/prompt (`summarizeDocWithClaude`)
 * and embedding (`embedChunks`) so backfilled rows match freshly-ingested ones.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { createClient } from "@supabase/supabase-js"

import { embedChunks } from "../lib/ingestion/embed.ts"
import { summarizeDocWithClaude } from "../lib/ingestion/summarize-doc.ts"

const HERE = dirname(fileURLToPath(import.meta.url))

// Load .env.local into process.env (no dotenv dep; same approach as the app's
// own tooling expects the file to exist).
for (const line of readFileSync(join(HERE, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const dryRun = process.argv.includes("--dry-run")
const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`
}

const { data: pending, error } = await admin
  .from("sources")
  .select("id, title, content_text")
  .eq("status", "ready")
  .is("summary", null)

if (error) {
  console.error("Query failed:", error.message)
  process.exit(1)
}

const rows = (pending ?? []).filter((r) => (r.content_text ?? "").trim().length > 0)
console.log(`${rows.length} ready source(s) without a summary${dryRun ? " (dry-run, nothing written)" : ""}`)
if (dryRun || rows.length === 0) process.exit(0)

let done = 0
let failed = 0
for (const row of rows) {
  try {
    const summary = (await summarizeDocWithClaude(row.content_text as string)).trim()
    if (summary.length === 0) throw new Error("empty summary")
    const embedding = (await embedChunks([summary]))[0]
    if (!embedding) throw new Error("empty embedding")

    const { error: updateError } = await admin
      .from("sources")
      .update({ summary, summary_embedding: toPgVector(embedding) })
      .eq("id", row.id)
    if (updateError) throw updateError

    done += 1
    console.log(`  [${done}/${rows.length}] ${row.title}`)
  } catch (e) {
    failed += 1
    console.error(`  FAILED ${row.id} (${row.title}):`, e instanceof Error ? e.message : e)
  }
}

console.log(`Done: ${done} summarized, ${failed} failed.`)
process.exit(failed > 0 ? 1 : 0)
