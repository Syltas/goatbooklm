/**
 * DE-5 — a substantial assistant answer with 0 valid citations (and that is
 * not one of the gate-refusal constants) gets flagged, not blocked/
 * regenerated. Pure, stateless — the render condition lives in
 * `message-item.tsx` (§4 Schicht 3 "Render-Regel").
 */
export function UngroundedBadge() {
  return (
    <span
      data-test="ungrounded-badge"
      className="inline-flex w-fit items-center rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-muted-foreground"
    >
      Nicht quellenbelegt — bitte prüfen
    </span>
  )
}
