import type { DialogueTurn } from "./dialogue-blocks"

/**
 * Schlanker ElevenLabs-Client (docs/specs/studio-audio.md) — REST via fetch,
 * kein SDK. Synthese läuft über die Text-to-Dialogue-API mit `eleven_v3`:
 * beide Stimmen in EINEM Stream pro Block, ElevenLabs macht Turn-Übergänge,
 * Unterbrechungen und Audio-Tags ([laughs], [sighs], …) selbst.
 *
 * Historie: v1 nutzte per-Turn-TTS mit `eleven_multilingual_v2`, weil die
 * Dialogue-API auf 2.000 Zeichen GESAMT pro Request limitiert. Der v3-Umbau
 * (Spike scripts/audio-spike.ts, 2026-07-21) drehte das: Skripte werden in
 * ~1.800-Zeichen-Blöcke zerlegt (`lib/studio/dialogue-blocks.ts`) und
 * blockweise synthetisiert. Per-Turn-v3 wäre schlechter — `eleven_v3` lehnt
 * `previous_text`/`next_text` ab (400 unsupported_model, empirisch), hätte
 * also gar keine Prosodie-Kontinuität über Turn-Grenzen.
 */

const API_BASE = "https://api.elevenlabs.io/v1"
const MODEL_ID = "eleven_v3"
const OUTPUT_FORMAT = "mp3_44100_128"

/**
 * Default-Stimmen: aktuelle ElevenLabs-Premade-Voices (per
 * `GET /v1/voices` gegen den Projekt-Account verifiziert, 2026-07-20 —
 * Legacy-Voices wie Rachel sind heute Library-Voices und werfen auf
 * Free-Plänen 402 "paid_plan_required"). George = Host 1 (führt, warmer
 * Storyteller), Sarah = Host 2. Via env übersteuerbar, ohne
 * Voice-Auswahl-UI (Spec: nicht in v1).
 */
const DEFAULT_VOICE_HOST1 = "JBFqnCBsd6RMkjVDRZzb" // George
const DEFAULT_VOICE_HOST2 = "EXAVITQu4vr4xnSDxMaL" // Sarah

export function voiceForSpeaker(speaker: 1 | 2): string {
  return speaker === 1
    ? process.env.ELEVENLABS_VOICE_HOST1 || DEFAULT_VOICE_HOST1
    : process.env.ELEVENLABS_VOICE_HOST2 || DEFAULT_VOICE_HOST2
}

/** Fehler mit bereits nutzerfähiger deutscher Meldung (Spec Fehler-Mapping). */
export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly status?: number
  ) {
    super(message)
    this.name = "ElevenLabsError"
  }
}

function mapError(status: number, body: string): string {
  // quota_exceeded kommt als 401 mit eigenem error-code (empirisch,
  // 2026-07-21: "This request exceeds your quota of 10000") — nicht als
  // 429. Body-Sniffing vor dem Status-Mapping, sonst hieße die Meldung
  // fälschlich "Key ungültig".
  if (body.includes("quota_exceeded") || status === 429) {
    return "ElevenLabs-Kontingent erschöpft. Bitte später erneut versuchen."
  }
  if (status === 401 || status === 403) {
    return "ElevenLabs-Key ungültig. Bitte ELEVENLABS_API_KEY prüfen."
  }
  return "Audio-Erzeugung fehlgeschlagen. Bitte erneut versuchen."
}

export interface SynthesizeDialogueBlockInput {
  apiKey: string
  /** Ein Block aus `buildDialogueBlocks` — Gesamttext ≤ ~1.800 Zeichen. */
  turns: DialogueTurn[]
}

/**
 * Synthetisiert einen Dialog-Block als eine MP3. Kein `language_code`-Param:
 * die Dialogue-API kennt keinen, `eleven_v3` erkennt die Sprache aus dem
 * Text. Keine `voice_settings`: der Spike lief mit Defaults am besten.
 */
export async function synthesizeDialogueBlock(
  input: SynthesizeDialogueBlockInput
): Promise<Uint8Array> {
  const url = `${API_BASE}/text-to-dialogue?output_format=${OUTPUT_FORMAT}`

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": input.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: input.turns.map((turn) => ({
          text: turn.text,
          voice_id: voiceForSpeaker(turn.speaker),
        })),
        model_id: MODEL_ID,
      }),
    })
  } catch (err) {
    throw new ElevenLabsError(
      `elevenlabs fetch failed: ${String(err)}`,
      "ElevenLabs nicht erreichbar. Bitte erneut versuchen."
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new ElevenLabsError(
      `elevenlabs ${response.status}: ${body.slice(0, 300)}`,
      mapError(response.status, body),
      response.status
    )
  }

  return new Uint8Array(await response.arrayBuffer())
}
