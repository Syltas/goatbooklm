import { z } from "zod"

/**
 * Audio-Overview-Schemas (docs/specs/studio-audio.md) — client-safe: die
 * Viewer/Dialoge brauchen Meta + defensives content-Parsen, die Route/der
 * Worker die Zod-Validierung.
 */

export const AUDIO_FORMAT_VALUES = ["deep_dive", "brief", "critique", "debate"] as const
export type AudioFormat = (typeof AUDIO_FORMAT_VALUES)[number]

export const AUDIO_FORMAT_META: Record<
  AudioFormat,
  { label: string; description: string }
> = {
  deep_dive: {
    label: "Deep Dive",
    description: "Ein lebhaftes Gespräch zweier Hosts, das die Themen deiner Quellen verbindet und vertieft",
  },
  brief: {
    label: "Kurzüberblick",
    description: "Ein kompakter Überblick über die Kernideen deiner Quellen",
  },
  critique: {
    label: "Kritik",
    description: "Ein Experten-Review deines Materials mit konstruktivem Feedback",
  },
  debate: {
    label: "Debatte",
    description: "Eine durchdachte Debatte zweier Hosts über die Perspektiven in deinen Quellen",
  },
}

/** Kuratierte Auswahl (Spec) — `eleven_v3` deckt 70+ Sprachen ab. */
export const AUDIO_LANGUAGES = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "Englisch" },
  { code: "es", label: "Spanisch" },
  { code: "fr", label: "Französisch" },
  { code: "it", label: "Italienisch" },
  { code: "pt", label: "Portugiesisch" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanisch" },
] as const

export const AUDIO_LANGUAGE_CODES = AUDIO_LANGUAGES.map((l) => l.code) as [
  string,
  ...string[],
]

export const AUDIO_LENGTH_VALUES = ["kurz", "standard", "lang"] as const
export type AudioLength = (typeof AUDIO_LENGTH_VALUES)[number]

export const AUDIO_LENGTH_META: Record<AudioLength, { label: string; words: string }> = {
  kurz: { label: "Kurz", words: "500-700 Wörter (≈ 4 Minuten)" },
  standard: { label: "Standard", words: "1.300-1.600 Wörter (≈ 10 Minuten)" },
  lang: { label: "Lang", words: "2.200-2.800 Wörter (≈ 15-18 Minuten)" },
}

/**
 * Kosten-Cap (Review-Fix R1-4): Skripte über diesem Gesamt-Zeichenlimit
 * gehen NIE in die TTS-Phase — kein unbegrenzter ElevenLabs-Spend durch
 * Runaway-Generierung. ≈ 20 min Audio, deckt „Lang" mit Puffer.
 */
export const SCRIPT_CHAR_CAP = 30_000

/**
 * Audio-Jobs dürfen legal mehrere Worker-Ticks überspannen (Budget-Exit +
 * vt-Ablauf bis ~10 min) — das 5-min-Fenster der Inline-Typen würde laufende
 * Jobs fälschlich claimbar machen (Review-Fix R1-2). Geteilte Konstante für
 * UI-Anzeige UND Service-Retry-Guard.
 */
export const STALE_GENERATING_MINUTES_AUDIO = 15

/** Skript-Shape — `generateObject`-Schema des Workers. */
export const audioScriptSchema = z.object({
  /** Episoden-Titel im Stil „<Thema> — Deep Dive". */
  title: z.string().min(1),
  turns: z
    .array(
      z.object({
        /** Sprecher 1 = Host/Expertin (führt), Sprecher 2 = Co-Host. */
        speaker: z.union([z.literal(1), z.literal(2)]),
        text: z.string().min(1),
      })
    )
    .min(3)
    // Backchannel-Mikro-Turns ("Mhm.", "Warte —") treiben die Turn-Zahl —
    // das Kosten-Cap bleibt SCRIPT_CHAR_CAP, nicht die Turn-Anzahl.
    .max(150),
})

export type AudioScript = z.infer<typeof audioScriptSchema>

export const audioParamsSchema = z.object({
  language: z.enum(AUDIO_LANGUAGE_CODES),
  length: z.enum(AUDIO_LENGTH_VALUES),
  focus: z.string().max(500).optional(),
})

export type AudioParams = z.infer<typeof audioParamsSchema>

/** Phasen-Lifecycle des content-jsonb (Spec "content-jsonb-Lifecycle"). */
export const audioContentSchema = z.object({
  params: audioParamsSchema,
  phase: z.enum(["script", "tts", "done"]),
  script: audioScriptSchema.optional(),
  tts: z
    .object({
      done: z.number().int().min(0),
      total: z.number().int().min(0),
      /**
       * Segment-Einheit. "block" = Dialogue-Block (v3-Umbau). Fehlt das
       * Feld, stammt der Zwischenstand aus der per-Turn-Ära — der Worker
       * startet die TTS-Phase dann von vorn statt Segmente zu mischen.
       */
      unit: z.literal("block").optional(),
    })
    .optional(),
  storage_path: z.string().optional(),
})

export type AudioContent = z.infer<typeof audioContentSchema>

/** Defensiv (Viewer/Worker): `null` statt Crash bei kaputtem Shape. */
export function parseAudioContent(content: unknown): AudioContent | null {
  const parsed = audioContentSchema.safeParse(content)
  return parsed.success ? parsed.data : null
}
