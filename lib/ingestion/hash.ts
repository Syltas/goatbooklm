/**
 * SHA-256 content hash for source dedupe (`sources.content_hash`) — hex,
 * lowercase. One implementation for both call sites: the browser (hashes
 * the file before the direct-to-Storage upload — see
 * `file-upload-tab.tsx`) and the Node.js worker (re-hashes the bytes it
 * actually downloaded — see `service.ts`'s `reconcileContentHash`).
 * `crypto.subtle.digest` is Web Crypto, available as a global in both
 * environments (browsers natively; Node.js >=20 — this repo requires >=22,
 * see package.json `engines`), so there is exactly one hash implementation
 * to keep in sync, not two that could quietly drift apart.
 */
/**
 * Content hash for the non-file source types (`text`, `web`) — dedupe keyed
 * on the EXTRACTED text rather than a raw file, because neither has a raw
 * file to hash.
 *
 * For web sources this is also the more correct basis even if the HTML were
 * available: the markup around an article (ads, nav, build hashes, CSRF
 * tokens) changes on almost every fetch while the article text does not, so
 * hashing the HTML would make the same page look like a new source every
 * time and defeat the dedupe entirely.
 */
export async function sha256HexOfText(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text))
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Cast: TS's DOM lib types `SubtleCrypto.digest` as wanting a
  // `BufferSource` backed specifically by `ArrayBuffer` (excluding
  // `SharedArrayBuffer`), which a generic `Uint8Array<ArrayBufferLike>`
  // doesn't structurally satisfy even though every real call site here only
  // ever passes a plain, non-shared buffer (from `File#arrayBuffer()` or a
  // Supabase Storage download) — safe to widen back to `BufferSource`.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
