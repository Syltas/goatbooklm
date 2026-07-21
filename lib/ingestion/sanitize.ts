/**
 * Postgres cannot store U+0000 in `text`/`jsonb` columns — PostgREST turns a
 * chunk insert whose content contains one into an
 * "unsupported Unicode escape sequence" error, failing the entire source with
 * `persistFailed`. pdf.js (via unpdf) emits U+0000 for glyphs that have no
 * Unicode mapping (embedded subset fonts without a ToUnicode CMap), so
 * real-world PDFs hit this routinely — a single such glyph anywhere in the
 * document used to kill the whole ingestion. Lone UTF-16 surrogates are
 * rejected by Postgres the same way ("Unicode low surrogate must follow a
 * high surrogate"), so they are covered here too.
 *
 * Replacement is deliberately LENGTH-PRESERVING (U+FFFD is one UTF-16 code
 * unit, exactly like the code units it replaces): `pageOffsets` and every
 * chunk's `char_start`/`char_end` are character offsets into this text, and
 * stripping instead of replacing would silently shift them all.
 */
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function sanitizeUnicode(text: string): string {
  return text.replace(UNSTORABLE, "�")
}
