import ExcelJS from "exceljs"

import { toMarkdownTable } from "./markdown-table"
import type { FileExtraction, FileExtractorInput } from "./types"

/**
 * `.xlsx` head — every worksheet is serialized as its own Markdown table
 * under an `## <sheet name>` heading, so a chunk that lands mid-workbook
 * still says which sheet it came from and keeps its header row (see
 * `markdown-table.ts`).
 *
 * Cells are rendered from their *displayed* value, not their raw storage:
 * a formula cell must contribute its cached result (the formula string
 * `=SUM(B2:B9)` is meaningless to a retrieval query), a date must be an ISO
 * date rather than an Excel serial number, and a hyperlink/rich-text cell
 * must contribute its text rather than `[object Object]` — see `cellToText`.
 */
export async function extractXlsx(
  input: FileExtractorInput
): Promise<FileExtraction> {
  const workbook = new ExcelJS.Workbook()
  // `Uint8Array` → `Buffer` view; ExcelJS's typings ask for its own Buffer
  // alias, which is structurally the Node Buffer this passes.
  await workbook.xlsx.load(Buffer.from(input.bytes) as unknown as ArrayBuffer)

  const sections: string[] = []

  workbook.eachSheet((worksheet) => {
    const rows: string[][] = []

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      // `row.eachCell` skips empty cells entirely, which would shift every
      // later value one column left. Index-addressing keeps columns aligned.
      const width = row.cellCount
      for (let col = 1; col <= width; col++) {
        cells.push(cellToText(row.getCell(col).value))
      }
      rows.push(cells)
    })

    const table = toMarkdownTable(rows)
    if (table) sections.push(`## ${worksheet.name}\n\n${table}`)
  })

  return { text: sections.join("\n\n") }
}

/**
 * ExcelJS models a cell value as a union of primitives and several tagged
 * object shapes. Rendering it with `String(value)` would emit
 * `[object Object]` for four of them, so each is unwrapped to the text a
 * person reading the spreadsheet would see.
 */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ""

  if (value instanceof Date) {
    // ISO date (no time component) — stable, sortable, and unambiguous
    // across locales, unlike Excel's own display formatting.
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>

    // Formula cell: use the cached result, never the formula source.
    if ("result" in record) return cellToText(record.result)
    // Shared-formula cell with no cached result yet.
    if ("formula" in record || "sharedFormula" in record) return ""
    // Hyperlink cell: the visible label, not the target URL.
    if ("text" in record) return cellToText(record.text)
    // Rich text: concatenate the runs.
    if ("richText" in record && Array.isArray(record.richText)) {
      return record.richText
        .map((run) => cellToText((run as { text?: unknown }).text))
        .join("")
    }
    // Error cell (#REF!, #DIV/0!) — surface the code, it is meaningful.
    if ("error" in record) return String(record.error)

    return ""
  }

  return String(value)
}
