/**
 * Schlanker ElevenLabs-TTS-Client (docs/specs/studio-audio.md) — REST via
 * fetch, kein SDK. Per-Turn-Synthese mit `previous_text`/`next_text` für
 * Prosodie-Kontinuität über Turn-Grenzen.
 *
 * Warum NICHT die Text-to-Dialogue-API: verifiziert 2026-07-20 gegen
 * https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert — sie
 * limitiert auf 2.000 Zeichen GESAMT pro Request. Schon ein „Kurz"-Skript
 * (~4.000 Zeichen) passt nicht; per-Turn-TTS ist der tragfähige Pfad
 * (Spec-OQ1 damit entschieden).
 */

const API_BASE = "https://api.elevenlabs.io/v1"
const MODEL_ID = "eleven_multilingual_v2"
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

function mapStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "ElevenLabs-Key ungültig. Bitte ELEVENLABS_API_KEY prüfen."
  }
  if (status === 429) {
    return "ElevenLabs-Kontingent erschöpft. Bitte später erneut versuchen."
  }
  return "Audio-Erzeugung fehlgeschlagen. Bitte erneut versuchen."
}

export interface SynthesizeTurnInput {
  apiKey: string
  speaker: 1 | 2
  text: string
  /** Text des vorherigen/nächsten Turns DESSELBEN Sprechers ist nicht nötig —
   *  ElevenLabs nutzt previous/next als Prosodie-Kontext des Streams. */
  previousText?: string
  nextText?: string
  /**
   * ISO 639-1 (aus params.language). Wird bewusst NICHT als
   * `language_code`-Body-Param gesendet: `eleven_multilingual_v2` lehnt den
   * Param ab (nur Turbo/Flash-Modelle akzeptieren ihn) und erkennt die
   * Sprache zuverlässig aus dem Text ganzer Sätze. Der Param bleibt im
   * Input-Shape für einen späteren Modellwechsel.
   */
  languageCode: string
}

export async function synthesizeTurn(input: SynthesizeTurnInput): Promise<Uint8Array> {
  const voiceId = voiceForSpeaker(input.speaker)
  const url = `${API_BASE}/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": input.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input.text,
        model_id: MODEL_ID,
        previous_text: input.previousText,
        next_text: input.nextText,
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
      mapStatus(response.status),
      response.status
    )
  }

  return new Uint8Array(await response.arrayBuffer())
}
