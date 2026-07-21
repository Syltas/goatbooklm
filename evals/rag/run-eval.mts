/**
 * RAG-Retrieval-Eval — end-to-end gegen die laufende App (`POST /api/chat`),
 * also inklusive echtem Embedding, `match_chunks`/`match_source_summaries`,
 * Grounding-Prompt und Refusal-Normalisierung. Bewusst NICHT Teil von
 * `pnpm eval` (das sind die fixture-basierten Prompt-Evals): dieses Script
 * braucht den laufenden Dev-Server + die lokale Supabase-Instanz.
 *
 * Aufruf:   node evals/rag/run-eval.mts            (Node >= 23, type stripping)
 * Optionen: --base http://localhost:3100   Ziel-App
 *           --questions <pfad>             Fragen-JSON (Default: ./questions.json)
 *           --keep-history                 Chat-History NICHT parken (Eval dann
 *                                          durch bestehende History kontaminiert)
 *
 * Ablauf pro Lauf:
 *  1. Login als Notebook-Owner: Service-Role `generateLink(magiclink)` →
 *     `verifyOtp` → Session; das Session-Cookie baut `@supabase/ssr` selbst
 *     (identisches Format wie im Browser, kein handgeschnitztes Cookie).
 *  2. Bestehende Chat-History wird GEPARKT (Backup-JSON → Delete), damit
 *     `HISTORY_WINDOW=6` nicht jede Folgefrage mit der vorherigen
 *     Eval-Antwort kontaminiert; nach jedem Turn werden die frisch
 *     persistierten Eval-Messages gelöscht → jede Frage läuft gegen leere
 *     History. Am Ende wird das Backup wiederhergestellt (auch bei Crash,
 *     via finally; das Backup-File bleibt zusätzlich auf Platte liegen).
 *  3. Metriken: overview-Hit = Antwort mit >= minSources verschiedenen
 *     zitierten Quellen; specific-Hit = erwartete Quelle unter den Zitaten;
 *     offtopic-korrekt = Refusal (Signal: `isRefusal` im
 *     `data-citations`-Streampart, Fallback: Textvergleich).
 *  4. Output: CSV (pro Frage + Summary) und ein README-taugliches SVG
 *     (light/dark via prefers-color-scheme) unter evals/rag/out/.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, "out")

// Spiegel der Gate-Konstanten aus lib/chat/messages.ts — nur als FALLBACK
// für die Refusal-Erkennung, primäres Signal ist `isRefusal` im Stream.
const NO_COVERAGE_MESSAGE = "Ihre Quellen enthalten dazu keine Informationen."

interface EvalQuestion {
  id: string
  category: "overview" | "specific" | "offtopic"
  question: string
  expectedSources?: string[]
  minSources?: number
}

interface QuestionsFile {
  notebookId: string
  notebookTitle: string
  questions: EvalQuestion[]
}

interface CitationDetail {
  sourceId: string
  sourceTitle: string
}

interface TurnResult {
  id: string
  category: EvalQuestion["category"]
  question: string
  status: "answered" | "refused" | "error"
  refused: boolean
  citations: number
  distinctSources: string[]
  expectedSources: string[]
  hit: boolean
  latencyMs: number
  answer: string
  error?: string
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const hasFlag = (name: string) => process.argv.includes(name)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Env + Clients

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env.local"))
} catch {
  // CI / bereits gesetzte Env
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Fehlende Env-Vars (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) — .env.local prüfen.")
  process.exit(1)
}

const BASE_URL = arg("--base") ?? "http://localhost:3100"
const questionsPath = arg("--questions") ?? path.join(__dirname, "questions.json")
const spec = JSON.parse(fs.readFileSync(questionsPath, "utf-8")) as QuestionsFile
const NOTEBOOK_ID = spec.notebookId

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---------------------------------------------------------------------------
// Login als Notebook-Owner → Session-Cookie im exakten @supabase/ssr-Format

async function buildSessionCookie(): Promise<string> {
  const { data: nb, error: nbErr } = await admin
    .from("notebooks")
    .select("user_id")
    .eq("id", NOTEBOOK_ID)
    .single()
  if (nbErr || !nb) throw new Error(`Notebook ${NOTEBOOK_ID} nicht gefunden: ${nbErr?.message}`)

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(nb.user_id)
  const email = userData?.user?.email
  if (userErr || !email) throw new Error(`Owner-User nicht auflösbar: ${userErr?.message}`)

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) throw new Error(`generateLink fehlgeschlagen: ${linkErr?.message}`)

  const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: otp, error: otpErr } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  })
  if (otpErr || !otp.session) throw new Error(`verifyOtp fehlgeschlagen: ${otpErr?.message}`)

  // Cookie-Erzeugung an @supabase/ssr delegieren — dieselbe Library, die der
  // Server zum Lesen benutzt, garantiert Namens- und Chunking-Kompatibilität.
  const jar = new Map<string, string>()
  const ssr = createServerClient(SUPABASE_URL!, ANON_KEY!, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const c of cookies) jar.set(c.name, c.value)
      },
    },
  })
  await ssr.auth.setSession({
    access_token: otp.session.access_token,
    refresh_token: otp.session.refresh_token,
  })
  for (let i = 0; i < 30 && jar.size === 0; i++) await sleep(100)
  if (jar.size === 0) throw new Error("Session-Cookie wurde nicht geschrieben (setSession)")

  console.log(`Login ok als ${email} (${jar.size} Cookie(s))`)
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ")
}

// ---------------------------------------------------------------------------
// History parken / wiederherstellen / Eval-Messages löschen

type MessageRow = Record<string, unknown>

async function parkHistory(): Promise<{ backupPath: string; rows: MessageRow[] }> {
  const { data, error } = await admin
    .from("messages")
    .select("*")
    .eq("notebook_id", NOTEBOOK_ID)
    .order("created_at", { ascending: true })
  if (error) throw new Error(`History-Backup fehlgeschlagen: ${error.message}`)

  const rows = data ?? []
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const backupPath = path.join(OUT_DIR, `history-backup-${Date.now()}.json`)
  fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2))

  const { error: delErr } = await admin.from("messages").delete().eq("notebook_id", NOTEBOOK_ID)
  if (delErr) throw new Error(`History-Delete fehlgeschlagen: ${delErr.message}`)
  console.log(`History geparkt: ${rows.length} Messages → ${path.relative(process.cwd(), backupPath)}`)
  return { backupPath, rows }
}

async function deleteEvalMessages(): Promise<void> {
  // Nach dem Parken ist jede vorhandene Message eine Eval-Message.
  const { error } = await admin.from("messages").delete().eq("notebook_id", NOTEBOOK_ID)
  if (error) console.warn(`  Warnung: Eval-Messages nicht gelöscht: ${error.message}`)
}

async function restoreHistory(rows: MessageRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await admin.from("messages").insert(rows)
  if (error) {
    console.error(`History-Restore FEHLGESCHLAGEN: ${error.message} — Backup-JSON liegt in evals/rag/out/`)
  } else {
    console.log(`History wiederhergestellt (${rows.length} Messages).`)
  }
}

// ---------------------------------------------------------------------------
// Ein Chat-Turn: POST /api/chat + UI-Message-Stream (SSE) parsen

async function askQuestion(
  cookie: string,
  q: EvalQuestion
): Promise<{ text: string; refused: boolean; citations: CitationDetail[]; error?: string }> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ notebookId: NOTEBOOK_ID, question: q.question }),
  })

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "")
    return { text: "", refused: false, citations: [], error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
  }

  let text = ""
  let refused = false
  let sawCitationsPart = false
  let citations: CitationDetail[] = []
  let streamError: string | undefined

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const payload = line.slice(6).trim()
      if (payload === "[DONE]") continue
      let part: any
      try {
        part = JSON.parse(payload)
      } catch {
        continue
      }
      if (part.type === "text-delta" && typeof part.delta === "string") text += part.delta
      if (part.type === "data-citations" && part.data) {
        sawCitationsPart = true
        refused = part.data.isRefusal === true
        citations = (part.data.citations ?? []).map((c: any) => ({
          sourceId: c.sourceId,
          sourceTitle: c.sourceTitle,
        }))
      }
      if (part.type === "error") streamError = String(part.errorText ?? part.error ?? "stream error")
    }
  }

  // Fallback, falls der data-citations-Part fehlt (z. B. Stream-Abbruch).
  if (!sawCitationsPart) refused = text.trim() === NO_COVERAGE_MESSAGE
  return { text, refused, citations, error: streamError }
}

// ---------------------------------------------------------------------------
// Scoring

function scoreTurn(q: EvalQuestion, turn: Awaited<ReturnType<typeof askQuestion>>, latencyMs: number): TurnResult {
  const distinctSources = [...new Set(turn.citations.map((c) => c.sourceTitle))]
  const expected = q.expectedSources ?? []
  let hit = false
  if (q.category === "specific") {
    hit = expected.every((title) => distinctSources.includes(title))
  } else if (q.category === "overview") {
    hit = !turn.refused && distinctSources.length >= (q.minSources ?? 2)
  } else {
    hit = turn.refused
  }
  return {
    id: q.id,
    category: q.category,
    question: q.question,
    status: turn.error ? "error" : turn.refused ? "refused" : "answered",
    refused: turn.refused,
    citations: turn.citations.length,
    distinctSources,
    expectedSources: expected,
    hit: turn.error ? false : hit,
    latencyMs,
    answer: turn.text,
    error: turn.error,
  }
}

// ---------------------------------------------------------------------------
// Outputs: CSV + SVG

function csvEscape(value: unknown): string {
  const s = String(value ?? "")
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function writeCsv(results: TurnResult[]): string {
  const header = [
    "id", "category", "question", "status", "refused", "citations",
    "distinct_sources", "cited_sources", "expected_sources", "hit",
    "latency_ms", "answer_excerpt",
  ]
  const lines = [header.join(",")]
  for (const r of results) {
    lines.push(
      [
        r.id, r.category, r.question, r.status, r.refused, r.citations,
        r.distinctSources.length, r.distinctSources.join(" | "),
        r.expectedSources.join(" | "), r.hit, r.latencyMs,
        r.answer.replace(/\s+/g, " ").slice(0, 160),
      ].map(csvEscape).join(",")
    )
  }
  const file = path.join(OUT_DIR, "rag-eval.csv")
  fs.writeFileSync(file, lines.join("\n") + "\n")
  return file
}

interface CategorySummary {
  category: string
  metric: string
  hits: number
  total: number
  pct: number
}

function summarize(results: TurnResult[]): CategorySummary[] {
  const defs: { category: EvalQuestion["category"]; label: string; metric: string }[] = [
    { category: "overview", label: "Overview", metric: "Hitrate (Antwort mit genug Quellen)" },
    { category: "specific", label: "Specific", metric: "Hitrate (erwartete Quelle zitiert)" },
    { category: "offtopic", label: "Offtopic", metric: "Refusal-Accuracy (korrekt verweigert)" },
  ]
  return defs.map((d) => {
    const rows = results.filter((r) => r.category === d.category)
    const hits = rows.filter((r) => r.hit).length
    return {
      category: d.label,
      metric: d.metric,
      hits,
      total: rows.length,
      pct: rows.length ? Math.round((hits / rows.length) * 100) : 0,
    }
  })
}

function writeSummaryCsv(summary: CategorySummary[]): string {
  const lines = ["category,metric,hits,total,pct"]
  for (const s of summary) {
    lines.push([s.category, s.metric, s.hits, s.total, s.pct].map(csvEscape).join(","))
  }
  const file = path.join(OUT_DIR, "rag-eval-summary.csv")
  fs.writeFileSync(file, lines.join("\n") + "\n")
  return file
}

/**
 * README-taugliches SVG (Balkendiagramm, eine Serie → keine Legende, direkte
 * Beschriftung). Farben/Ink folgen der validierten Referenz-Palette des
 * dataviz-Skills; light/dark via prefers-color-scheme im eingebetteten
 * <style> — GitHub rendert das in beiden Themes korrekt.
 */
function writeSvg(summary: CategorySummary[], meta: { date: string; n: number }): string {
  const width = 760
  const barMaxW = 430
  const rowH = 64
  const top = 92
  const labelX = 24
  const barX = 200
  const height = top + summary.length * rowH + 40

  const gridPct = [0, 25, 50, 75, 100]
  const grid = gridPct
    .map((p) => {
      const x = barX + (p / 100) * barMaxW
      return `<line x1="${x}" y1="${top - 14}" x2="${x}" y2="${top + summary.length * rowH - 18}" class="grid"/>
<text x="${x}" y="${top + summary.length * rowH + 2}" class="tick" text-anchor="middle">${p}</text>`
    })
    .join("\n")

  const bars = summary
    .map((s, i) => {
      const y = top + i * rowH
      const w = Math.max((s.pct / 100) * barMaxW, 2)
      const barH = 20
      // Balken am Nullpunkt verankert, 4px-Rundung nur am Datenende.
      const r = Math.min(4, w / 2)
      const barPath = `M ${barX} ${y} h ${w - r} a ${r} ${r} 0 0 1 ${r} ${r} v ${barH - 2 * r} a ${r} ${r} 0 0 1 ${-r} ${r} h ${-(w - r)} z`
      return `<text x="${labelX}" y="${y + 10}" class="label">${s.category}</text>
<text x="${labelX}" y="${y + 26}" class="sublabel">${s.metric}</text>
<path d="${barPath}" class="bar"/>
<text x="${barX + w + 10}" y="${y + 15}" class="value">${s.pct} % (${s.hits}/${s.total})</text>`
    })
    .join("\n")

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="RAG-Eval: Hitrate und Refusal-Accuracy pro Fragenkategorie">
<style>
  :root { color-scheme: light dark; }
  .surface { fill: #fcfcfb; }
  .title { font: 600 17px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #0b0b0b; }
  .subtitle { font: 400 12px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #52514e; }
  .label { font: 600 13px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #0b0b0b; }
  .sublabel { font: 400 11px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #52514e; }
  .value { font: 600 13px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #0b0b0b; font-variant-numeric: tabular-nums; }
  .tick { font: 400 10px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #898781; font-variant-numeric: tabular-nums; }
  .grid { stroke: #e1e0d9; stroke-width: 1; }
  .bar { fill: #2a78d6; }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #1a1a19; }
    .title, .label, .value { fill: #ffffff; }
    .subtitle, .sublabel { fill: #c3c2b7; }
    .tick { fill: #898781; }
    .grid { stroke: #2c2c2a; }
    .bar { fill: #3987e5; }
  }
</style>
<rect class="surface" x="0" y="0" width="${width}" height="${height}" rx="8"/>
<text x="24" y="34" class="title">RAG-Eval — Notebook „${spec.notebookTitle}“ (17 Quellen)</text>
<text x="24" y="54" class="subtitle">${meta.n} Fragen · E2E gegen /api/chat (Retrieval + Grounding) · ${meta.date}</text>
${grid}
${bars}
</svg>
`
  const file = path.join(OUT_DIR, "rag-eval.svg")
  fs.writeFileSync(file, svg)
  return file
}

// ---------------------------------------------------------------------------
// Main

async function main(): Promise<void> {
  // Dev-Server erreichbar?
  try {
    await fetch(BASE_URL, { method: "HEAD" })
  } catch {
    console.error(`App unter ${BASE_URL} nicht erreichbar — läuft "pnpm dev" (Port 3100)?`)
    process.exit(1)
  }

  const cookie = await buildSessionCookie()

  let parked: { backupPath: string; rows: MessageRow[] } | null = null
  if (!hasFlag("--keep-history")) {
    parked = await parkHistory()
  } else {
    console.log("--keep-history: History bleibt stehen (Eval dadurch kontaminierbar).")
  }

  const results: TurnResult[] = []
  try {
    for (const [i, q] of spec.questions.entries()) {
      process.stdout.write(`[${i + 1}/${spec.questions.length}] ${q.id} (${q.category}) … `)
      const started = Date.now()
      let turn: Awaited<ReturnType<typeof askQuestion>>
      try {
        turn = await askQuestion(cookie, q)
      } catch (err) {
        turn = { text: "", refused: false, citations: [], error: String(err) }
      }
      const result = scoreTurn(q, turn, Date.now() - started)
      results.push(result)
      console.log(
        `${result.hit ? "HIT " : "MISS"} status=${result.status} sources=[${result.distinctSources.join(", ")}] ${result.latencyMs}ms` +
          (result.error ? ` error=${result.error}` : "")
      )

      // persistTurn läuft in after() nach Stream-Ende — kurz warten, dann die
      // Eval-Messages löschen, damit die nächste Frage leere History sieht.
      if (parked) {
        await sleep(2500)
        await deleteEvalMessages()
      }
      await sleep(500)
    }
  } finally {
    if (parked) {
      await deleteEvalMessages()
      await restoreHistory(parked.rows)
    }
  }

  const summary = summarize(results)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  fs.writeFileSync(
    path.join(OUT_DIR, "rag-eval-results.json"),
    JSON.stringify({ date, notebookId: NOTEBOOK_ID, summary, results }, null, 2)
  )
  const csvFile = writeCsv(results)
  const summaryFile = writeSummaryCsv(summary)
  const svgFile = writeSvg(summary, { date, n: results.length })

  console.log("\n=== RAG Eval Summary ===")
  for (const s of summary) {
    console.log(`  ${s.category.padEnd(9)} ${String(s.pct).padStart(3)} %  (${s.hits}/${s.total})  ${s.metric}`)
  }
  const errors = results.filter((r) => r.status === "error")
  if (errors.length) console.log(`  Fehler: ${errors.length} Frage(n) — siehe CSV/JSON`)
  console.log(`\n  CSV:     ${path.relative(process.cwd(), csvFile)}`)
  console.log(`  Summary: ${path.relative(process.cwd(), summaryFile)}`)
  console.log(`  SVG:     ${path.relative(process.cwd(), svgFile)}`)
  console.log(`  JSON:    evals/rag/out/rag-eval-results.json`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
