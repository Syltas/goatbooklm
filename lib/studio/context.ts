/**
 * Kontext-Aufbau für Report-Generierung — pure Funktionen, client-safe
 * (der Viewer nutzt `splitLeadingH1` auch für den Live-Stream).
 */

/**
 * Gesamt-Zeichenbudget für den Quellen-Kontext. ~300k Zeichen ≈ 140k
 * Input-Tokens bei ~2,1 Zeichen/Token für deutschen Text — dieselbe
 * empirisch verifizierte Konvention wie `lib/chat/limits.ts` (NICHT die
 * übliche 4-Zeichen-Faustregel, die für Deutsch ~2x daneben liegt und auf
 * großen Notebooks das Kontextfenster sprengen würde).
 */
export const CONTEXT_CHAR_BUDGET = 300_000

export const TRUNCATION_MARKER = "\n\n[… gekürzt …]\n\n"

export interface ContextSource {
  id: string
  title: string
  contentText: string
}

/**
 * Kürzt einen Quelltext auf `budget` Zeichen: 70 % vom Anfang + 30 % vom
 * Ende, Mitte fällt raus (Spec "Kontext-Budget"). Anfang trägt bei den
 * meisten Dokumenten Thema/These, das Ende Fazit/Ergebnis — die Mitte ist
 * am ehesten verzichtbar.
 */
export function truncateFairly(text: string, budget: number): string {
  if (text.length <= budget) return text
  const usable = Math.max(0, budget - TRUNCATION_MARKER.length)
  const headLength = Math.floor(usable * 0.7)
  const tailLength = usable - headLength
  const head = text.slice(0, headLength)
  const tail = tailLength > 0 ? text.slice(-tailLength) : ""
  return `${head}${TRUNCATION_MARKER}${tail}`
}

/**
 * Baut den Quellen-Block für den Prompt. Übersteigt die Summe das Budget,
 * bekommt jede Quelle denselben fairen Anteil (Budget / Quellenanzahl) und
 * wird einzeln 70/30 gekürzt — kein RAG-top-k, Reports brauchen die
 * Gesamtsicht über alle Quellen.
 */
export function buildSourcesBlock(
  sources: ContextSource[],
  budget: number = CONTEXT_CHAR_BUDGET
): string {
  const total = sources.reduce((sum, source) => sum + source.contentText.length, 0)
  const perSourceBudget =
    total > budget ? Math.floor(budget / Math.max(1, sources.length)) : Infinity

  return sources
    .map((source, index) => {
      const body =
        perSourceBudget === Infinity
          ? source.contentText
          : truncateFairly(source.contentText, perSourceBudget)
      return `<quelle nr="${index + 1}" titel="${source.title}">\n${body}\n</quelle>`
    })
    .join("\n\n")
}

/**
 * Trennt eine führende `# `-H1 vom Rest. Persistenz: H1 wird `title`, der
 * Body wird OHNE H1 gespeichert (Viewer zeigt den Titel separat — sonst
 * doppelt, Review-Fix R2-5). Der Viewer nutzt dieselbe Funktion im
 * Live-Stream. Keine H1 → `title: null`, Body unverändert.
 */
export function splitLeadingH1(markdown: string): {
  title: string | null
  body: string
} {
  const match = /^\s*#[ \t]+(.+?)[ \t]*\r?\n/.exec(markdown)
  if (!match) return { title: null, body: markdown }
  const title = match[1].trim()
  if (title.length === 0) return { title: null, body: markdown }
  return { title, body: markdown.slice(match[0].length).replace(/^\s*\n/, "") }
}
