import type { ReportFormat } from "./schema"

/**
 * Prompt-Registry für Report-Formate. Append-only halten (Spec
 * "Parallelisierungs-Plan"): Flash Cards / Quiz docken später als eigene
 * Registries an, ohne diese Datei umzubauen.
 *
 * Server-only wie `lib/chat/prompt.ts`: Prompt-Engineering-Text gehört
 * nicht ins Client-Bundle. Die UI importiert ihre Format-Metadaten aus dem
 * client-safe `lib/studio/format-meta.ts`, nie von hier.
 */

const SHARED_RULES = `Du bist ein Recherche-Assistent. Du erstellst ein Dokument AUSSCHLIESSLICH aus den bereitgestellten Quellen — kein externes Wissen, keine erfundenen Fakten. Antworte auf Deutsch.

Regeln:
- Erste Zeile der Antwort ist IMMER ein prägnanter Dokument-Titel als Markdown-H1 ("# Titel").
- Danach klar strukturierte Abschnitte mit "## "-Überschriften.
- GitHub-flavored Markdown. Keine HTML-Tags.
- Wo du dich direkt auf eine Quelle stützt, nenne sie im Fließtext beim Titel (z. B. "laut <Quellentitel>"), keine Fußnoten-Syntax.
- Widersprechen sich Quellen, benenne den Widerspruch explizit.`

const FORMAT_PROMPTS: Record<ReportFormat, string> = {
  briefing_doc: `${SHARED_RULES}

Format: BRIEFING-DOKUMENT — Überblick über die Quellen mit den wichtigsten Erkenntnissen und Zitaten.
Struktur:
## Zusammenfassung — 1 Absatz Gesamtbild.
## Kernthemen — die 3-6 wichtigsten Themen, je ein kurzer Abschnitt mit den zentralen Erkenntnissen.
## Wichtige Zitate — 3-5 wörtliche, prägnante Zitate aus den Quellen (als Markdown-Blockquote, mit Quellentitel).
## Offene Punkte — was die Quellen NICHT beantworten (nur wenn relevant).`,

  study_guide: `${SHARED_RULES}

Format: LERNLEITFADEN (Study Guide) — zum Selbstlernen und Prüfen.
Struktur:
## Kurzfragen-Quiz — 8-10 Fragen mit kurzen Antworten (Frage fett, Antwort direkt darunter).
## Essay-Fragen — 3-4 vertiefende Fragen OHNE Antworten, die Transferdenken über mehrere Quellen verlangen.
## Glossar — die wichtigsten Schlüsselbegriffe aus den Quellen mit je 1-2 Sätzen Definition.`,

  blog_post: `${SHARED_RULES}

Format: BLOG-POST — die Erkenntnisse der Quellen als gut lesbarer Artikel.
Struktur:
- Einstieg mit einer klaren These oder überraschenden Erkenntnis.
- 3-5 Abschnitte mit "## "-Zwischenüberschriften, erzählerischer Ton, aber faktentreu zu den Quellen.
- ## Fazit — was der Leser mitnehmen soll.`,
}

export function reportSystemPrompt(format: ReportFormat): string {
  return FORMAT_PROMPTS[format]
}

/** User-Turn: Quellen-Block + Arbeitsauftrag. */
export function buildReportUserTurn(sourcesBlock: string): string {
  return `Hier sind die Quellen:\n\n${sourcesBlock}\n\nErstelle jetzt das Dokument gemäß deiner Format-Anweisung. Beginne mit der "# Titel"-Zeile.`
}

/**
 * Hinweiszeile bei `finishReason !== 'stop'` (Chat-Pattern
 * `appendIncompleteHint`): Report bleibt `ready`, aber der Leser sieht,
 * dass das Ende fehlt.
 */
export const REPORT_INCOMPLETE_HINT =
  "\n\n---\n\n*Hinweis: Dieser Bericht wurde wegen des Längenlimits gekürzt beendet.*"
