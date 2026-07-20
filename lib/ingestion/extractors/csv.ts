import { toMarkdownTable } from "./markdown-table"
import { stripBom } from "./plain-text"
import type { FileExtraction, FileExtractorInput } from "./types"

/**
 * `.csv` head — decodes, parses, and re-serializes as a Markdown table so
 * each chunk keeps its header row and cell↔column relationship (see
 * `markdown-table.ts` for why that matters for retrieval).
 *
 * Hand-rolled RFC 4180 parser rather than a dependency: the grammar is small
 * and fully covered by the tests, and the alternatives all bring a parser
 * with its own streaming/encoding surface for what amounts to a quote-state
 * machine. It handles quoted fields, escaped quotes (`""`), embedded commas
 * and newlines inside quotes, and both CRLF and LF line endings.
 */
export async function extractCsv(input: FileExtractorInput): Promise<FileExtraction> {
  // Same `fatal: true` rationale as `plain-text.ts` — a mis-picked binary
  // must fail loudly rather than embed as replacement characters.
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const text = stripBom(decoder.decode(input.bytes))

  const rows = parseCsv(text, detectDelimiter(text))
  return { text: toMarkdownTable(rows) }
}

/**
 * Picks `;` over `,` when the first line clearly contains more of it —
 * German-locale Excel exports use a semicolon, and parsing those with a
 * comma yields a single-column table where every row is one long string.
 * Only the first line is sampled: it is the header, and a delimiter that
 * dominates there is the real one.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? ""
  const semicolons = (firstLine.match(/;/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  const tabs = (firstLine.match(/\t/g) ?? []).length

  if (tabs > semicolons && tabs > commas) return "\t"
  return semicolons > commas ? ";" : ","
}

export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0

  const pushField = () => {
    row.push(field)
    field = ""
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote; a single
        // one ends the field.
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true
      i += 1
      continue
    }

    if (char === delimiter) {
      pushField()
      i += 1
      continue
    }

    if (char === "\r" || char === "\n") {
      pushRow()
      // Consume CRLF as one line ending, not two.
      i += char === "\r" && text[i + 1] === "\n" ? 2 : 1
      continue
    }

    field += char
    i += 1
  }

  // A file not ending in a newline still has a final row pending; one that
  // does would otherwise gain a spurious trailing empty row.
  if (field.length > 0 || row.length > 0) pushRow()

  return rows
}
