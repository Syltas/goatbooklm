const CARD_COLOR_SLOTS = 6

export const NOTEBOOK_DEFAULT_EMOJI = "📓"

/**
 * Deterministic hash of a notebook id into one of the 6 pastel palette slots
 * defined in DESIGN.md (`--card-1`…`--card-6`). Same id → same color, every
 * render, every session — no randomness, no per-notebook DB column needed
 * (Non-Goals + Annahme 14, specs/01-notebooks.md).
 */
export function getNotebookCardColor(notebookId: string): string {
  let hash = 0
  for (let i = 0; i < notebookId.length; i++) {
    hash = (hash * 31 + notebookId.charCodeAt(i)) >>> 0
  }
  const slot = (hash % CARD_COLOR_SLOTS) + 1
  return `var(--card-${slot})`
}

const notebookDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "long",
  year: "numeric",
})

export function formatNotebookDate(iso: string): string {
  return notebookDateFormatter.format(new Date(iso))
}
