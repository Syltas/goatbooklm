import mammoth from "mammoth"

import { assertZipWithinLimits } from "../zip-guard"
import type { FileExtraction, FileExtractorInput } from "./types"

/**
 * `.docx` head — text extraction via `mammoth`, the same library the task
 * brief names. It walks the OOXML document body and returns the readable
 * prose, discarding styling; `extractRawText` is the right entry point here
 * (rather than `convertToHtml`) because the pipeline only ever chunks and
 * embeds plain text — HTML tags would become embedded noise and would show
 * up literally in the reader.
 *
 * `mammoth` expects a Node `Buffer`, so the `Uint8Array` the worker
 * downloads is wrapped rather than copied.
 *
 * Note this head does NOT catch its own errors: a corrupt or
 * password-protected file rejects here, and `extractContent` turns that into
 * the format's `docxCorrupt` message. Keeping the mapping in one place means
 * every head fails the same way.
 */
export async function extractDocx(
  input: FileExtractorInput
): Promise<FileExtraction> {
  // Decompression-bomb guard (`zip-guard.ts`): a .docx is a ZIP container, and
  // `mammoth.extractRawText` below fully decompresses it into memory — a 15 MB
  // file whose inner XML expands to GBs would OOM-kill the worker (uncatchable)
  // before any of this runs. Verify the declared uncompressed footprint from
  // the central directory first; a violation (or anything unverifiable) throws,
  // which `extractContent` maps to the format's `corrupt` message terminally.
  assertZipWithinLimits(input.bytes)

  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(input.bytes),
  })

  // `mammoth` separates paragraphs with a single `\n`; collapse runs of 3+
  // blank lines that empty paragraphs produce, so the chunker's token budget
  // isn't spent on whitespace.
  const text = value.replace(/\n{3,}/g, "\n\n").trim()

  return { text }
}
