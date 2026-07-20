import type { FileExtraction, FileExtractorInput } from "./types"

/**
 * `.txt` / `.md` head — no extraction library involved, the bytes already
 * ARE the text. The only real work is decoding defensively.
 *
 * `fatal: true` on the decoder is the point of this module: the default
 * `TextDecoder` silently replaces invalid UTF-8 with U+FFFD, which would
 * turn a mis-picked binary file into a chunk of replacement characters that
 * embeds and stores "successfully" — a silently corrupt source rather than a
 * visible error. Failing loudly lets `extractContent` surface the format's
 * own `corrupt` message instead.
 *
 * A UTF-8 BOM is stripped rather than kept: it would otherwise land at
 * `content_text[0]`, shifting every citation offset the reader highlights by
 * one character.
 */
export async function extractPlainText(
  input: FileExtractorInput
): Promise<FileExtraction> {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const text = decoder.decode(input.bytes)
  return { text: stripBom(text) }
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
