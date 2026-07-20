import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  ACCEPT_ATTRIBUTE,
  ALL_ALLOWED_MIME_TYPES,
  FILE_FORMATS,
  MAX_UPLOAD_BYTES,
  detectFileFormat,
  isFileSourceType,
  matchesMagic,
  stripKnownExtension,
} from "../formats"

/**
 * The format registry is what nine previously-hard-coded "is this a PDF?"
 * decisions now all route through, so a mistake here is a mistake in all of
 * them at once — hence the coverage of detection, magic bytes, and the
 * derived constants the client and the bucket migration both depend on.
 */
describe("detectFileFormat", () => {
  it.each([
    ["report.pdf", "application/pdf", "pdf"],
    ["notes.txt", "text/plain", "txt"],
    ["readme.md", "text/markdown", "md"],
    ["readme.markdown", "", "md"],
    ["brief.docx", "", "docx"],
    ["zahlen.xlsx", "", "xlsx"],
    ["export.csv", "text/csv", "csv"],
    ["foto.png", "image/png", "image"],
    ["foto.JPG", "image/jpeg", "image"],
    ["foto.jpeg", "", "image"],
    ["foto.webp", "image/webp", "image"],
  ])("maps %s to type %s", (fileName, mime, expected) => {
    const result = detectFileFormat(fileName, mime)
    expect(result.ok && result.type).toBe(expected)
  })

  it("prefers the extension over a wrong browser-reported MIME type", () => {
    // Real case: some platforms report `application/octet-stream` for .md
    // and .csv. The extension is what the user actually picked.
    const result = detectFileFormat("export.csv", "application/octet-stream")
    expect(result.ok && result.type).toBe("csv")
  })

  it("falls back to the MIME type when the file name has no extension", () => {
    const result = detectFileFormat("scan", "image/png")
    expect(result).toEqual({ ok: true, type: "image", extension: ".png" })
  })

  it.each([
    ["clip.mp4", ""],
    ["clip.mov", ""],
    ["clip.MKV", ""],
    // Extension lists are never complete — the MIME prefix is the backstop.
    ["recording.bin", "video/x-matroska"],
  ])("rejects video %s as its own reason, not as generic 'unsupported'", (name, mime) => {
    expect(detectFileFormat(name, mime)).toEqual({ ok: false, reason: "video" })
  })

  it("rejects a genuinely unsupported type as 'unsupported'", () => {
    expect(detectFileFormat("archive.zip", "application/zip")).toEqual({
      ok: false,
      reason: "unsupported",
    })
  })
})

describe("matchesMagic", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 ...")
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ])
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])

  it("accepts each format's real signature", () => {
    expect(matchesMagic("pdf", pdf)).toBe(true)
    expect(matchesMagic("image", png)).toBe(true)
    expect(matchesMagic("image", jpeg)).toBe(true)
    expect(matchesMagic("image", webp)).toBe(true)
    // docx/xlsx are ZIP containers.
    expect(matchesMagic("docx", zip)).toBe(true)
    expect(matchesMagic("xlsx", zip)).toBe(true)
  })

  it("rejects bytes whose content does not match the claimed type", () => {
    // This is the check that stops a renamed file (spoofed content-type,
    // spoofed extension) from reaching the wrong extraction head.
    expect(matchesMagic("pdf", png)).toBe(false)
    expect(matchesMagic("image", pdf)).toBe(false)
    expect(matchesMagic("docx", pdf)).toBe(false)
  })

  it("does not reject a WebP whose size field differs (bytes 4-7 vary)", () => {
    const other = new Uint8Array(webp)
    other[4] = 0xff
    other[5] = 0xee
    expect(matchesMagic("image", other)).toBe(true)
  })

  it("passes signature-less formats through — their decoder is the real check", () => {
    const arbitrary = new TextEncoder().encode("beliebiger Text")
    expect(matchesMagic("txt", arbitrary)).toBe(true)
    expect(matchesMagic("md", arbitrary)).toBe(true)
    expect(matchesMagic("csv", arbitrary)).toBe(true)
  })

  it("rejects a truncated signature rather than reading past the buffer", () => {
    expect(matchesMagic("pdf", new Uint8Array([0x25, 0x50]))).toBe(false)
    expect(matchesMagic("image", new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false)
  })
})

describe("stripKnownExtension", () => {
  it("strips a recognized extension, case-insensitively", () => {
    expect(stripKnownExtension("Briefing-VZUG.pdf")).toBe("Briefing-VZUG")
    expect(stripKnownExtension("Foto.JPG")).toBe("Foto")
    expect(stripKnownExtension("Notizen.markdown")).toBe("Notizen")
  })

  it("leaves an unrecognized suffix alone rather than truncating the title", () => {
    // "Version 1.2" must not become "Version 1" — the old `/\.pdf$/i` was
    // safe here only because it matched one literal extension.
    expect(stripKnownExtension("Bericht v1.2")).toBe("Bericht v1.2")
    expect(stripKnownExtension("ohne-endung")).toBe("ohne-endung")
  })
})

describe("derived constants", () => {
  it("isFileSourceType separates file-backed types from text/web", () => {
    expect(isFileSourceType("pdf")).toBe(true)
    expect(isFileSourceType("image")).toBe(true)
    expect(isFileSourceType("text")).toBe(false)
    expect(isFileSourceType("web")).toBe(false)
  })

  it("ACCEPT_ATTRIBUTE covers every registered extension", () => {
    for (const spec of Object.values(FILE_FORMATS)) {
      for (const ext of spec.extensions) {
        expect(ACCEPT_ATTRIBUTE).toContain(ext)
      }
    }
  })

  it("gives images a tighter cap than PDFs", () => {
    // The whole point of per-type limits: a 20MB image is not a 20MB PDF.
    expect(FILE_FORMATS.image.maxBytes).toBeLessThan(FILE_FORMATS.pdf.maxBytes)
  })
})

// ---------------------------------------------------------------------------
// Storage bucket <-> registry guard
// ---------------------------------------------------------------------------

/**
 * This guard used to be a lie: it compared `ALL_ALLOWED_MIME_TYPES` against a
 * THIRD hard-coded copy of the list written inline in the test, and never
 * opened a `.sql` file at all. It therefore caught a change to `formats.ts`
 * (the copy it did watch) but stayed silent on exactly the direction that
 * actually breaks uploads — a MIME type removed from, or never added to, the
 * migration — and on any later migration touching the bucket again. Worse,
 * its failure message pointed at the test literal, inviting the reader to
 * "fix" the test instead of the SQL.
 *
 * It now reads the migrations and reconstructs the bucket's EFFECTIVE final
 * state by replaying every `storage.buckets` statement in filename order,
 * which is the order `supabase db reset` applies them in. Replaying rather
 * than reading one known file is the point: the allowlist is already set
 * twice (created in `..._create_sources_storage_bucket.sql`, widened in
 * `..._extend_source_formats.sql`), so a guard pinned to a single file would
 * go stale the moment a third migration touches the bucket.
 *
 * A statement it cannot parse fails the test rather than being skipped —
 * silently ignoring an unrecognized future statement is the same failure
 * mode all over again.
 */
const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url)
)

interface BucketState {
  allowedMimeTypes: string[]
  fileSizeLimit: number
}

/** Splits a comma-separated SQL list, ignoring commas inside quotes,
 *  parentheses or an `array[...]` literal. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ""

  for (const char of list) {
    if (char === "'") quoted = !quoted
    if (!quoted) {
      if (char === "[" || char === "(") depth++
      else if (char === "]" || char === ")") depth--
      else if (char === "," && depth === 0) {
        parts.push(current.trim())
        current = ""
        continue
      }
    }
    current += char
  }

  if (current.trim()) parts.push(current.trim())
  return parts
}

function parseSqlArray(expression: string): string[] {
  const match = expression.match(/^array\s*\[([\s\S]*)\]$/i)
  if (!match) throw new Error(`not a SQL array literal: ${expression}`)
  return splitTopLevel(match[1]).map((item) => {
    const value = item.match(/^'([\s\S]*)'$/)
    if (!value) throw new Error(`not a quoted SQL string: ${item}`)
    return value[1]
  })
}

/** Applies one `column = value` assignment (from either an INSERT's zipped
 *  column/value lists or an UPDATE's SET clause) to the running state. */
function applyAssignment(state: BucketState, column: string, expression: string) {
  if (column === "allowed_mime_types") {
    state.allowedMimeTypes = parseSqlArray(expression)
  } else if (column === "file_size_limit") {
    const size = Number(expression)
    if (!Number.isInteger(size)) {
      throw new Error(`file_size_limit is not an integer literal: ${expression}`)
    }
    state.fileSizeLimit = size
  }
}

function effectiveSourcesBucketState(): BucketState {
  const state: BucketState = { allowedMimeTypes: [], fileSizeLimit: -1 }
  let statementsSeen = 0

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()

  for (const file of files) {
    // Line comments first — the migrations discuss `allowed_mime_types` in
    // prose, and prose must never be parsed as a statement.
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8").replace(
      /--[^\n]*/g,
      ""
    )

    for (const raw of sql.split(";")) {
      const statement = raw.trim().replace(/\s+/g, " ")
      if (!/storage\.buckets/i.test(statement)) continue
      if (!statement.includes("'sources'")) continue

      const insert = statement.match(
        /^insert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values\s*\(([\s\S]*)\)\s*(?:on\s+conflict[\s\S]*)?$/i
      )
      const update = statement.match(
        /^update\s+storage\.buckets\s+set\s+([\s\S]*?)\s+where\s+[\s\S]*$/i
      )

      if (insert) {
        const columns = splitTopLevel(insert[1]).map((c) => c.toLowerCase())
        const values = splitTopLevel(insert[2])
        expect(values).toHaveLength(columns.length)
        columns.forEach((column, i) => applyAssignment(state, column, values[i]))
      } else if (update) {
        for (const assignment of splitTopLevel(update[1])) {
          const [, column, expression] =
            assignment.match(/^([a-z_]+)\s*=\s*([\s\S]*)$/i) ?? []
          if (!column) throw new Error(`unparsed SET assignment in ${file}: ${assignment}`)
          applyAssignment(state, column.toLowerCase(), expression)
        }
      } else {
        throw new Error(
          `${file} contains a storage.buckets statement this guard cannot parse — ` +
            `extend the parser rather than deleting the guard:\n${statement}`
        )
      }

      statementsSeen++
    }
  }

  // A zero here would make every assertion below pass vacuously.
  expect(statementsSeen).toBeGreaterThan(0)
  return state
}

describe("sources Storage bucket ↔ format registry", () => {
  const bucket = effectiveSourcesBucketState()

  it("the bucket's effective allowed_mime_types equals ALL_ALLOWED_MIME_TYPES", () => {
    // The bucket allowlist is SQL and cannot import from `formats.ts`, and
    // the client uploads straight to Storage — so a format present here but
    // missing there is rejected at upload time with no code-level signal,
    // and a MIME type present there but missing here is an allowlist wider
    // than the registry the worker validates against.
    expect([...bucket.allowedMimeTypes].sort()).toEqual(ALL_ALLOWED_MIME_TYPES)
  })

  it("the bucket's effective file_size_limit equals MAX_UPLOAD_BYTES", () => {
    // The coarse backstop must match the registry's largest per-type cap: a
    // smaller bucket limit silently rejects a legal upload at the edge, a
    // larger one lets bytes land in Storage that the worker will only reject
    // after paying for the download.
    expect(bucket.fileSizeLimit).toBe(MAX_UPLOAD_BYTES)
  })
})
