/**
 * Shared row-grid → Markdown-table serializer for the two tabular heads
 * (`.csv` and `.xlsx`).
 *
 * Why Markdown rather than the obvious "join cells with commas/tabs": a
 * chunk is retrieved and shown to the model in isolation, with no column
 * headers unless they are carried inside the chunk text itself. A bare
 * `4711,Legienhof,2026-03-01` tells the model nothing about what those
 * values are; the same row in a Markdown table sits under a header row and
 * keeps its cell↔column relationship readable. It also renders as an actual
 * table in the source reader, which uses `remark-gfm`.
 */

/** Cells may legitimately contain pipes and newlines; both would otherwise
 *  break the row into extra columns or extra rows and silently scramble the
 *  grid. Escape the pipe, and flatten in-cell newlines to `<br>` (GFM's own
 *  in-cell line break) rather than dropping the content. */
function escapeCell(value: string): string {
  return value
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, "<br>")
    .trim()
}

/**
 * Renders `rows` as a GFM table. The first row is treated as the header —
 * spreadsheets and CSVs almost always lead with one, and a table whose
 * header row is data is still readable, whereas a table with no header row
 * at all is not valid GFM.
 *
 * Returns `""` for an empty grid so callers can apply their own "no data"
 * message rather than persisting a header-only skeleton.
 */
export function toMarkdownTable(rows: string[][]): string {
  const nonEmpty = rows.filter((row) => row.some((cell) => cell.trim().length > 0))
  if (nonEmpty.length === 0) return ""

  // Ragged rows are normal in real spreadsheets (trailing empty cells are
  // not stored). Pad every row to the widest one so the pipe counts line up
  // — GFM renders a row with too few cells as a broken table.
  const width = Math.max(...nonEmpty.map((row) => row.length))
  const pad = (row: string[]) =>
    Array.from({ length: width }, (_, i) => escapeCell(row[i] ?? ""))

  const [header, ...body] = nonEmpty
  const lines = [
    `| ${pad(header).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`),
  ]

  return lines.join("\n")
}
