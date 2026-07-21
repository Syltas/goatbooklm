/**
 * Spike: klingt eleven_v3 (Audio-Tags, Text-to-Dialogue) auf Deutsch besser
 * als die aktuelle eleven_multilingual_v2-Per-Turn-Pipeline? Rendert EIN
 * Testdialog in drei Varianten nach spike-out/:
 *
 *   a-v2-turns.mp3    — Status quo: per-Turn-TTS, multilingual_v2, Tags entfernt
 *   b-v3-turns.mp3    — per-Turn-TTS, eleven_v3, mit Audio-Tags
 *   c-v3-dialogue.mp3 — Text-to-Dialogue-API, eleven_v3, ein Block, beide Stimmen
 *
 * Nebenbefunde, die der Spike mitbeantwortet:
 *   - akzeptiert eleven_v3 previous_text/next_text? (Variante b probiert es,
 *     fällt bei 400 automatisch darauf zurück, sie wegzulassen, und loggt das)
 *   - was kostet jede Variante wirklich? (Quota vor/nach jeder Variante)
 *   - ist v3 / Text-to-Dialogue auf dem Plan überhaupt freigeschaltet?
 *
 * Run:
 *   node scripts/audio-spike.ts          # alle drei Varianten
 *   node scripts/audio-spike.ts b c      # nur Teilmenge (spart Quota bei Retries)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, "..", "spike-out")

for (const line of readFileSync(join(HERE, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}

const apiKey = process.env.ELEVENLABS_API_KEY
if (!apiKey) {
  console.error("Missing ELEVENLABS_API_KEY in .env.local")
  process.exit(1)
}

const API_BASE = "https://api.elevenlabs.io/v1"
const OUTPUT_FORMAT = "mp3_44100_128"
// Identisch zu lib/studio/elevenlabs.ts (dort nicht exportiert): George / Sarah.
const VOICE_HOST1 = process.env.ELEVENLABS_VOICE_HOST1 || "JBFqnCBsd6RMkjVDRZzb"
const VOICE_HOST2 = process.env.ELEVENLABS_VOICE_HOST2 || "EXAVITQu4vr4xnSDxMaL"

interface Turn {
  speaker: 1 | 2
  text: string
}

/**
 * Testdialog mit allem, was der neue Prompt können soll: Backchannel-Mikro-
 * Turns, False Start + Selbstkorrektur, "ähm", Unterbrechung (Gedankenstrich
 * + [interrupting]), [laughs]/[sighs]/[curious], Ellipsen. ~1.200 Zeichen.
 */
const DIALOG: Turn[] = [
  {
    speaker: 1,
    text: "Okay, ich muss direkt mit der Sache einsteigen, die mich seit Tagen nicht loslässt: Städte sind nachts bis zu zehn Grad wärmer als das Umland. Zehn Grad!",
  },
  { speaker: 2, text: "Mhm." },
  {
    speaker: 1,
    text: "Und das Verrückte ist — also, ich dachte erst, das liegt an den Heizungen, an den Autos, ähm... an all dem, was wir so laufen haben. Liegt es aber nicht. Jedenfalls nicht hauptsächlich.",
  },
  { speaker: 2, text: "[curious] Warte, sondern?" },
  {
    speaker: 1,
    text: "Beton. Asphalt. Die Stadt selbst ist ein riesiger Wärmespeicher, der tagsüber auflädt und nachts —",
  },
  {
    speaker: 2,
    text: "[interrupting] — und nachts gibt er alles wieder ab. Wie eine Herdplatte, die man ausgeschaltet hat.",
  },
  {
    speaker: 1,
    text: "[laughs] Genau! Genau das. Du fasst quasi um Mitternacht noch auf die Herdplatte.",
  },
  {
    speaker: 2,
    text: "[sighs] Okay, aber jetzt mal ehrlich... das heißt ja: je mehr Klimaanlagen laufen, desto schlimmer wird es draußen, oder? Die pumpen die Wärme ja nur raus auf die Straße.",
  },
  {
    speaker: 1,
    text: "Ja, genau. Ein Teufelskreis. Und genau da wird es richtig spannend...",
  },
]

const stripTags = (text: string) => text.replace(/\[[^\]]+\]\s*/g, "").trim()
const voiceFor = (speaker: 1 | 2) => (speaker === 1 ? VOICE_HOST1 : VOICE_HOST2)

async function apiFetch(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE}${path}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function quota(): Promise<{ used: number; limit: number }> {
  const res = await fetch(`${API_BASE}/user/subscription`, {
    headers: { "xi-api-key": apiKey! },
  })
  if (!res.ok) throw new Error(`subscription ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { character_count: number; character_limit: number }
  return { used: json.character_count, limit: json.character_limit }
}

async function failBody(res: Response): Promise<string> {
  return (await res.text().catch(() => "")).slice(0, 400)
}

function concat(segments: Uint8Array[]): Uint8Array {
  const total = segments.reduce((sum, s) => sum + s.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const s of segments) {
    out.set(s, offset)
    offset += s.length
  }
  return out
}

/** a — Status quo: multilingual_v2 per Turn, Tags entfernt (v2 versteht keine). */
async function variantA(): Promise<Uint8Array> {
  const turns = DIALOG.map((t) => ({ ...t, text: stripTags(t.text) })).filter((t) => t.text)
  const segments: Uint8Array[] = []
  for (let i = 0; i < turns.length; i++) {
    const res = await apiFetch(`/text-to-speech/${voiceFor(turns[i].speaker)}`, {
      text: turns[i].text,
      model_id: "eleven_multilingual_v2",
      previous_text: i > 0 ? turns[i - 1].text : undefined,
      next_text: i < turns.length - 1 ? turns[i + 1].text : undefined,
    })
    if (!res.ok) throw new Error(`v2 turn ${i}: ${res.status} ${await failBody(res)}`)
    segments.push(new Uint8Array(await res.arrayBuffer()))
  }
  return concat(segments)
}

/** b — eleven_v3 per Turn mit Tags; probiert previous/next_text, fällt bei 400 zurück. */
async function variantB(): Promise<Uint8Array> {
  let contextSupported = true
  const segments: Uint8Array[] = []
  for (let i = 0; i < DIALOG.length; i++) {
    const base = {
      text: DIALOG[i].text,
      model_id: "eleven_v3",
      voice_settings: { stability: 0.5 }, // v3: nur 0.0 / 0.5 / 1.0 — "Natural"
    }
    const withContext = {
      ...base,
      previous_text: i > 0 ? DIALOG[i - 1].text : undefined,
      next_text: i < DIALOG.length - 1 ? DIALOG[i + 1].text : undefined,
    }
    let res = await apiFetch(`/text-to-speech/${voiceFor(DIALOG[i].speaker)}`, contextSupported ? withContext : base)
    if (res.status === 400 && contextSupported) {
      const body = await failBody(res)
      console.log(`  [b] 400 mit previous/next_text (Turn ${i}): ${body}`)
      console.log("  [b] → Retry ohne Kontext-Parameter; v3 unterstützt sie offenbar nicht")
      contextSupported = false
      res = await apiFetch(`/text-to-speech/${voiceFor(DIALOG[i].speaker)}`, base)
    }
    if (!res.ok) throw new Error(`v3 turn ${i}: ${res.status} ${await failBody(res)}`)
    segments.push(new Uint8Array(await res.arrayBuffer()))
  }
  console.log(`  [b] previous_text/next_text von eleven_v3 akzeptiert: ${contextSupported}`)
  return concat(segments)
}

/** c — Text-to-Dialogue: ein Request, beide Stimmen, ElevenLabs macht das Timing. */
async function variantC(): Promise<Uint8Array> {
  const totalChars = DIALOG.reduce((sum, t) => sum + t.text.length, 0)
  console.log(`  [c] Dialog-Block: ${totalChars} Zeichen (Limit 2.000)`)
  const res = await apiFetch("/text-to-dialogue", {
    inputs: DIALOG.map((t) => ({ text: t.text, voice_id: voiceFor(t.speaker) })),
    model_id: "eleven_v3",
  })
  if (!res.ok) throw new Error(`dialogue: ${res.status} ${await failBody(res)}`)
  return new Uint8Array(await res.arrayBuffer())
}

const VARIANTS: Record<string, { file: string; run: () => Promise<Uint8Array> }> = {
  a: { file: "a-v2-turns.mp3", run: variantA },
  b: { file: "b-v3-turns.mp3", run: variantB },
  c: { file: "c-v3-dialogue.mp3", run: variantC },
}

const requested = process.argv.slice(2).filter((arg) => arg in VARIANTS)
const keys = requested.length > 0 ? requested : Object.keys(VARIANTS)

mkdirSync(OUT_DIR, { recursive: true })

let { used, limit } = await quota()
console.log(`Quota: ${used}/${limit} Zeichen verbraucht (${limit - used} frei)\n`)

for (const key of keys) {
  const { file, run } = VARIANTS[key]
  console.log(`Variante ${key} → ${file}`)
  const started = Date.now()
  try {
    const audio = await run()
    writeFileSync(join(OUT_DIR, file), audio)
    const after = await quota()
    console.log(
      `  ok: ${(audio.length / 1024).toFixed(0)} KiB in ${((Date.now() - started) / 1000).toFixed(1)}s, ` +
        `Kosten: ${after.used - used} Credits\n`
    )
    used = after.used
  } catch (err) {
    console.error(`  FEHLER: ${err instanceof Error ? err.message : String(err)}\n`)
  }
}

console.log(`Fertig. Anhören: open ${OUT_DIR}`)
