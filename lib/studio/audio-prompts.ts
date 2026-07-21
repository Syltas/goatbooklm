import type { AudioFormat, AudioLength, AudioParams } from "./audio-schema"
import { AUDIO_LANGUAGES, AUDIO_LENGTH_META } from "./audio-schema"

/**
 * Skript-Prompts für Audio Overviews (docs/specs/studio-audio.md) —
 * server-only wie `lib/studio/prompts.ts`. Registry append-only.
 */

const LENGTH_TARGET: Record<AudioLength, string> = {
  kurz: AUDIO_LENGTH_META.kurz.words,
  standard: AUDIO_LENGTH_META.standard.words,
  lang: AUDIO_LENGTH_META.lang.words,
}

const FORMAT_BRIEFS: Record<AudioFormat, string> = {
  deep_dive: `Format: DEEP DIVE — ein lebhaftes Gespräch zweier Podcast-Hosts.
- Sprecher 1 führt durch die Episode, Sprecher 2 fragt nach, ergänzt und bringt eigene Beobachtungen.
- Verbinde die Themen der Quellen miteinander, statt sie nacheinander abzuarbeiten; arbeite überraschende Zusammenhänge heraus.
- Natürlicher Gesprächsfluss: kurze Turns, echte Reaktionen ("Genau!", "Moment —"), keine Vorlesungen.`,
  brief: `Format: KURZÜBERBLICK — zwei Hosts, kompakt.
- Sprecher 1 und 2 wechseln sich zügig ab und bringen die Kernideen der Quellen auf den Punkt.
- Kein Abschweifen, keine Nebenpfade: was muss jemand in wenigen Minuten mitnehmen?`,
  critique: `Format: KRITIK — EINE Experten-Stimme (ausschließlich Sprecher 1, KEIN Sprecher 2).
- Ein konstruktives Review des Materials: was ist stark, was ist schwach, was fehlt, was wäre konkret zu verbessern.
- Direkt und fair, mit Begründungen aus den Quellen selbst.`,
  debate: `Format: DEBATTE — zwei Hosts mit bewusst gegensätzlichen Positionen.
- Sprecher 1 und Sprecher 2 vertreten unterschiedliche, aus den Quellen belegbare Perspektiven.
- Fair und beleuchtend, kein Streit-Theater: beide Seiten bekommen ihre stärksten Argumente.`,
}

export function audioScriptSystemPrompt(format: AudioFormat, params: AudioParams): string {
  const languageLabel =
    AUDIO_LANGUAGES.find((l) => l.code === params.language)?.label ?? params.language

  return `Du schreibst das Skript für einen Audio-Beitrag, der AUSSCHLIESSLICH auf den bereitgestellten Quellen basiert — kein externes Wissen, keine erfundenen Fakten. Das gesamte Skript ist auf ${languageLabel} (Sprachcode ${params.language}).

${FORMAT_BRIEFS[format]}

Regeln:
- "title": prägnanter Episoden-Titel in derselben Sprache.
- "turns": die Redebeiträge in Reihenfolge; "speaker" ist 1 oder 2 (bei Kritik nur 1).
- Gesamtlänge: ${LENGTH_TARGET[params.length]} gesprochener Text.
- Reiner Sprechtext: keine Regieanweisungen, kein Markdown, keine Sprecher-Namen im Text selbst.
- Teile längere Monologe in mehrere aufeinanderfolgende Turns desselben Sprechers (je Turn ein Gedanke/Absatz, grob 2-6 Sätze) — auch im Ein-Sprecher-Format.
- Zahlen und Abkürzungen ausschreiben, wie man sie spricht.
- Steigen Sprecher direkt ins Thema ein (kein "Willkommen zu unserem Podcast"-Boilerplate), aber mit einem Satz Orientierung, worum es geht.`
}

export function buildAudioScriptUserTurn(
  sourcesBlock: string,
  focus: string | undefined
): string {
  const focusBlock = focus?.trim()
    ? `\n\nFokus-Anweisung des Nutzers (hat Vorrang bei der Themenwahl): ${focus.trim()}`
    : ""
  return `Hier sind die Quellen:\n\n${sourcesBlock}${focusBlock}\n\nSchreibe jetzt das Skript gemäß deiner Format-Anweisung.`
}
