/**
 * Single source of truth for every file format the ingestion pipeline
 * accepts — extension, MIME allowlist, per-type size limit, and magic-byte
 * signature, all in one table.
 *
 * Why a registry rather than per-call-site constants: the pipeline used to
 * hard-code "PDF" in nine independent places (storage-path suffix, size
 * check, magic bytes, delete-cleanup gate, notebook-sweep filter,
 * stale-pending guard, client extension strip, MIME validation, bucket
 * allowlist). Every one of those was a place a new format could silently
 * break. They now all read from this table instead, so adding a format is a
 * single entry here plus one extraction head.
 *
 * Zero-dependency on purpose (same rationale as `messages.ts`): the
 * client-side upload tab imports `detectFileFormat`/`ACCEPT_ATTRIBUTE` to
 * pre-validate a selection, and must not pull in `service.ts`'s
 * Supabase-typed surface or any Node-only extraction library.
 */

/** Source types backed by a file in Storage — i.e. everything except the
 *  `text` (pasted/note) and `web` (URL) types, which have no upload. */
export type FileSourceType = "pdf" | "txt" | "md" | "docx" | "xlsx" | "csv" | "image"

/** Every value `sources.type` may hold — must stay in sync with the CHECK
 *  constraint in `20260720190000_extend_source_formats.sql`. */
export type SourceType = FileSourceType | "text" | "web"

const FILE_SOURCE_TYPES: FileSourceType[] = [
  "pdf",
  "txt",
  "md",
  "docx",
  "xlsx",
  "csv",
  "image",
]

export function isFileSourceType(type: string): type is FileSourceType {
  return (FILE_SOURCE_TYPES as string[]).includes(type)
}

export interface FormatSpec {
  /** Lowercase extensions (with dot) that map to this type. The FIRST entry
   *  is the canonical one used for a Storage path when the uploaded file
   *  name carries no usable extension. */
  extensions: string[]
  /** Browser-reported MIME types accepted for this format. Advisory only —
   *  a client-supplied content-type is trivially spoofable, which is why
   *  `magic` below is re-checked server-side on the downloaded bytes. */
  mimeTypes: string[]
  /**
   * Per-type cap on the ACTUAL downloaded bytes (`extractContent` enforces
   * it in the worker, not just at upload time). Deliberately not one shared
   * constant: a 20 MB PNG costs a vision call over a ~27 MB base64 payload,
   * while a 20 MB PDF is just text extraction — the same number means very
   * different things per format.
   */
  maxBytes: number
  /** Leading byte signature, as a latin1 string, or `null` for formats with
   *  no reliable magic number (plain text/markdown/CSV are just bytes). */
  magic: string | null
  /** Human-readable size limit for user-facing messages ("max. 20 MB"). */
  label: string
}

const MB = 1_048_576

export const FILE_FORMATS: Record<FileSourceType, FormatSpec> = {
  pdf: {
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    maxBytes: 20 * MB,
    magic: "%PDF-",
    label: "PDF",
  },
  txt: {
    extensions: [".txt"],
    // Some browsers report an empty string for .txt on certain platforms;
    // the extension check below is what actually decides the type.
    mimeTypes: ["text/plain"],
    maxBytes: 2 * MB,
    magic: null,
    label: "Textdatei",
  },
  md: {
    extensions: [".md", ".markdown"],
    mimeTypes: ["text/markdown", "text/x-markdown", "text/plain"],
    maxBytes: 2 * MB,
    magic: null,
    label: "Markdown-Datei",
  },
  docx: {
    extensions: [".docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    maxBytes: 15 * MB,
    // OOXML is a ZIP container — "PK\x03\x04".
    magic: "PK",
    label: "Word-Dokument",
  },
  xlsx: {
    extensions: [".xlsx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    maxBytes: 15 * MB,
    magic: "PK",
    label: "Excel-Tabelle",
  },
  csv: {
    extensions: [".csv"],
    mimeTypes: ["text/csv", "application/csv", "text/plain"],
    maxBytes: 5 * MB,
    magic: null,
    label: "CSV-Tabelle",
  },
  image: {
    extensions: [".png", ".jpg", ".jpeg", ".webp"],
    mimeTypes: ["image/png", "image/jpeg", "image/webp"],
    // Anthropic's Messages API caps a single image at 5 MB; a larger file
    // would be rejected by the vision call itself, so reject it here with a
    // message that explains the actual limit instead.
    maxBytes: 5 * MB,
    // Three different signatures share one type — checked by
    // `matchesMagic` below rather than this single-string field.
    magic: null,
    label: "Bild",
  },
}

/**
 * Video is rejected with its own message rather than the generic
 * "Dateityp nicht erlaubt" — a user dropping an .mp4 has a specific
 * expectation, and "not allowed" reads like a bug rather than a scope
 * decision. Extensions AND the `video/` MIME prefix, since a container
 * extension list is never complete.
 */
const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".wmv",
  ".flv",
]

/**
 * Per-image magic numbers as raw byte values — `image` covers three
 * encodings, so it cannot use `FormatSpec.magic`'s single-signature field.
 * Written as numbers rather than latin1 string literals because two of the
 * three signatures contain non-printable bytes (PNG's 0x89/0x1A, JPEG's
 * 0xFF), where a string literal would invite a silent encoding mistake.
 *
 * Each entry is a list of (offset, bytes) parts that must ALL match. WebP is
 * the only multi-part one: it is RIFF-based, so bytes 0-3 are "RIFF" and
 * bytes 8-11 are "WEBP" — the four bytes in between are the file size and
 * vary per file, so they cannot be part of a fixed prefix check.
 */
const IMAGE_MAGIC: { offset: number; bytes: number[] }[][] = [
  // PNG: \x89 P N G \r \n \x1A \n
  [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  // JPEG: SOI (\xFF\xD8) followed by any marker start (\xFF)
  [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  // WebP: "RIFF" <4-byte size> "WEBP"
  [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
]

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase()
}

/** Strips the (recognized) extension for the default source title — the
 *  generalization of what used to be a hard-coded `/\.pdf$/i`. */
export function stripKnownExtension(fileName: string): string {
  const ext = fileExtension(fileName)
  if (!ext) return fileName
  const known = Object.values(FILE_FORMATS).some((spec) =>
    spec.extensions.includes(ext)
  )
  return known ? fileName.slice(0, -ext.length) : fileName
}

export type FormatDetection =
  | { ok: true; type: FileSourceType; extension: string }
  | { ok: false; reason: "video" | "unsupported" }

/**
 * Resolves an upload to a source type from its file name and (advisory)
 * MIME type. Extension-first: the browser's reported MIME is inconsistent
 * across platforms for text/markdown/CSV, whereas the extension is what the
 * user actually chose. MIME is only consulted as a fallback when the name
 * carries no recognizable extension.
 *
 * Never trusts either input as proof of content — the worker re-checks the
 * downloaded bytes against `matchesMagic` before extraction.
 */
export function detectFileFormat(
  fileName: string,
  mimeType?: string | null
): FormatDetection {
  const ext = fileExtension(fileName)
  const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim()

  if (VIDEO_EXTENSIONS.includes(ext) || mime.startsWith("video/")) {
    return { ok: false, reason: "video" }
  }

  for (const type of FILE_SOURCE_TYPES) {
    if (FILE_FORMATS[type].extensions.includes(ext)) {
      return { ok: true, type, extension: ext }
    }
  }

  if (mime) {
    for (const type of FILE_SOURCE_TYPES) {
      if (FILE_FORMATS[type].mimeTypes.includes(mime)) {
        return { ok: true, type, extension: FILE_FORMATS[type].extensions[0] }
      }
    }
  }

  return { ok: false, reason: "unsupported" }
}

/**
 * Verifies the leading bytes match what the claimed type must start with.
 * Formats without a signature (txt/md/csv) always pass — there is nothing to
 * check, and the decode step catches genuinely binary content instead.
 */
export function matchesMagic(type: FileSourceType, bytes: Uint8Array): boolean {
  if (type === "image") {
    return IMAGE_MAGIC.some((signature) =>
      signature.every(({ offset, bytes: expected }) =>
        hasBytesAt(bytes, expected, offset)
      )
    )
  }

  const magic = FILE_FORMATS[type].magic
  if (!magic) return true
  return hasBytesAt(
    bytes,
    Array.from(magic, (char) => char.charCodeAt(0)),
    0
  )
}

function hasBytesAt(bytes: Uint8Array, expected: number[], offset: number): boolean {
  if (bytes.byteLength < offset + expected.length) return false
  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected[i]) return false
  }
  return true
}

/** The `accept` attribute for the upload input — every supported extension
 *  plus MIME type, derived from the table so it can never drift from it. */
export const ACCEPT_ATTRIBUTE = Array.from(
  new Set(
    FILE_SOURCE_TYPES.flatMap((type) => [
      ...FILE_FORMATS[type].extensions,
      ...FILE_FORMATS[type].mimeTypes,
    ])
  )
).join(",")

/** Largest per-type limit — the Storage bucket's own `file_size_limit` and
 *  the Zod schema's coarse upper bound. The precise per-type check happens
 *  server-side on the real bytes (`extractContent`). */
export const MAX_UPLOAD_BYTES = Math.max(
  ...FILE_SOURCE_TYPES.map((type) => FILE_FORMATS[type].maxBytes)
)

/** Every MIME type the Storage bucket allowlist must carry. */
export const ALL_ALLOWED_MIME_TYPES = Array.from(
  new Set(FILE_SOURCE_TYPES.flatMap((type) => FILE_FORMATS[type].mimeTypes))
).sort()

/** Formats a byte cap for a user-facing message ("20 MB"). */
export function formatByteLimit(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`
}
