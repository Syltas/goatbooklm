/**
 * Decompression-bomb guard for ZIP-container formats (`.xlsx`, `.docx`, and
 * any future OOXML type). The upload path only ever caps the *compressed*
 * bytes (`FormatSpec.maxBytes` = 15 MB for docx/xlsx, checked in
 * `service.ts`), and the magic check only verifies the leading `PK`
 * signature — so a 15 MB file whose inner XML entries expand to multiple GB
 * sails through both and then OOM-kills the shared ingestion worker the
 * moment ExcelJS/mammoth fully decompresses every entry into memory. An
 * OOM (or a `maxDuration` kill) is NOT catchable by `try/catch`: the process
 * just dies, and pgmq redelivers the same poisoned job forever.
 *
 * The defense is to look BEFORE decompressing: a ZIP's central directory
 * records the uncompressed size of every entry up front (that is how any
 * unzip tool knows how much to allocate), and a real zip bomb declares those
 * sizes honestly. So we parse the central directory, sum the declared
 * uncompressed sizes, count the entries, and reject if either exceeds a sane
 * bound — a deterministic, cheap, pure-JS check with no new dependency.
 *
 * Fail-closed by design (the task's explicit requirement): anything we cannot
 * verify — a central directory we cannot parse, or a ZIP64 size marker whose
 * real value lives in an extra field we do not decode — is REJECTED, not
 * waved through. A guard that "passes when unsure" is not a guard.
 *
 * The thrown `ZipGuardError` propagates out of the extractor and is mapped by
 * `extractContent`'s existing catch to the format's `corrupt` message — a
 * *handled*, terminal failure (`sources.status = 'error'`), so the worker
 * deletes the job instead of crash-looping it. Retrying never helps: the same
 * bytes deterministically produce the same rejection.
 */

/**
 * Total declared uncompressed size across all entries we will tolerate.
 *
 * Sized off the worst *honest* expansion, not an arbitrary round number: the
 * docx/xlsx compressed cap is 15 MB (`FormatSpec.maxBytes`), and a dense,
 * genuine .xlsx of shared-string XML can legitimately expand ~10-15x, i.e. up
 * to ~225 MB. A 200 MB cap would false-reject such a real file at the top of
 * the size limit. 500 MB (≈ the 15 MB cap at a ~33x honest ratio) leaves
 * comfortable headroom over that ~225 MB worst case while staying far below
 * the multi-GB expansion a real bomb targets (deflate tops out near 1000x, so
 * a 15 MB bomb aims for ~15 GB) — and below what would threaten the worker's
 * heap.
 */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024

/**
 * Hard cap on entry count, independent of total size — stops the
 * "many tiny entries" bomb (hundreds of thousands of near-empty files, each
 * cheap on its own but collectively exhausting per-entry bookkeeping/handles
 * before the byte total ever trips). A real .xlsx/.docx has tens to low
 * hundreds of parts, never five figures.
 */
export const MAX_ZIP_ENTRIES = 10_000

/** ZIP64 sentinel: a 32-bit size/offset field holding all-ones means "the
 *  real 64-bit value is stored elsewhere (a ZIP64 extra field / EOCD record)"
 *  — which we do not decode. Seeing it means "cannot verify" -> fail closed. */
const ZIP64_UINT32_MARKER = 0xffffffff
/** Same idea for the 16-bit total-entries field in the EOCD. */
const ZIP64_UINT16_MARKER = 0xffff

// End Of Central Directory record: signature "PK\x05\x06", fixed part 22 bytes
// (+ a trailing comment of up to 0xFFFF bytes).
const EOCD_SIGNATURE = [0x50, 0x4b, 0x05, 0x06]
const EOCD_MIN_SIZE = 22
const MAX_ZIP_COMMENT = 0xffff

// Central Directory file header: signature "PK\x01\x02", fixed part 46 bytes,
// then variable file name + extra field + comment.
const CENTRAL_FILE_HEADER_SIGNATURE = [0x50, 0x4b, 0x01, 0x02]
const CENTRAL_FILE_HEADER_MIN_SIZE = 46

/**
 * Distinguishes the two rejection reasons so the caller can pick a message
 * (and so tests can assert intent rather than a string): `"limit"` = the
 * archive is verifiably too large (declared uncompressed total / entry count
 * over the bound), `"unverifiable"` = we could not confirm it is safe (no
 * parseable central directory, or a ZIP64 marker we do not decode). Both are
 * terminal; the split is purely for diagnosis.
 */
export type ZipGuardReason = "limit" | "unverifiable"

export class ZipGuardError extends Error {
  readonly reason: ZipGuardReason
  constructor(reason: ZipGuardReason, detail: string) {
    super(`ZIP rejected (${reason}): ${detail}`)
    this.name = "ZipGuardError"
    this.reason = reason
  }
}

/** Little-endian readers over the raw bytes — used instead of a `DataView` so
 *  there is zero chance of a `byteOffset` mismatch when the input is a
 *  subarray/Buffer view. Multiplication (not `<< 24`) keeps uint32 unsigned;
 *  a shift would sign-flip the high bit and break the ZIP64-marker compare. */
function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100
}
function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  )
}

function matchesSignatureAt(
  bytes: Uint8Array,
  signature: number[],
  offset: number
): boolean {
  if (offset < 0 || offset + signature.length > bytes.byteLength) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

/**
 * Locates the End Of Central Directory record by scanning backward from the
 * end (it sits at the very end, after an optional variable-length comment).
 * A byte sequence inside a comment could coincidentally look like the EOCD
 * signature, so a candidate is accepted only when its own comment-length
 * field is consistent with the file actually ending there. Returns -1 when no
 * consistent EOCD is found (caller fails closed).
 */
function findEocdOffset(bytes: Uint8Array): number {
  const len = bytes.byteLength
  if (len < EOCD_MIN_SIZE) return -1

  const scanFloor = Math.max(0, len - EOCD_MIN_SIZE - MAX_ZIP_COMMENT)
  for (let p = len - EOCD_MIN_SIZE; p >= scanFloor; p--) {
    if (!matchesSignatureAt(bytes, EOCD_SIGNATURE, p)) continue
    const commentLength = readUint16LE(bytes, p + 20)
    if (p + EOCD_MIN_SIZE + commentLength === len) return p
  }
  return -1
}

/**
 * Throws `ZipGuardError` if the ZIP in `bytes` declares an uncompressed
 * footprint (or entry count) beyond the configured bounds, or if it cannot be
 * verified (unparseable central directory / ZIP64). Returns normally
 * (`void`) for an archive that is verifiably within limits.
 *
 * Reads ONLY the central directory — it never inflates a single byte, so it
 * cannot itself be bombed. Assumes the caller has already confirmed the `PK`
 * container magic (the ingestion worker does, via `matchesMagic`, before
 * dispatching to the extractor); if the bytes are not actually a ZIP the
 * EOCD lookup fails and this rejects as `"unverifiable"`.
 */
export function assertZipWithinLimits(bytes: Uint8Array): void {
  const eocdOffset = findEocdOffset(bytes)
  if (eocdOffset === -1) {
    throw new ZipGuardError("unverifiable", "end-of-central-directory not found")
  }

  const totalEntries = readUint16LE(bytes, eocdOffset + 10)
  const centralDirSize = readUint32LE(bytes, eocdOffset + 12)
  const centralDirOffset = readUint32LE(bytes, eocdOffset + 16)

  // ZIP64: any of these three fields maxed out means the real value lives in a
  // ZIP64 record we do not parse — cannot verify, so reject.
  if (
    totalEntries === ZIP64_UINT16_MARKER ||
    centralDirSize === ZIP64_UINT32_MARKER ||
    centralDirOffset === ZIP64_UINT32_MARKER
  ) {
    throw new ZipGuardError("unverifiable", "ZIP64 markers present")
  }

  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new ZipGuardError(
      "limit",
      `${totalEntries} entries exceeds max ${MAX_ZIP_ENTRIES}`
    )
  }

  // The central directory must lie within the file.
  if (centralDirOffset + centralDirSize > bytes.byteLength) {
    throw new ZipGuardError("unverifiable", "central directory out of bounds")
  }

  let offset = centralDirOffset
  let totalUncompressed = 0

  for (let i = 0; i < totalEntries; i++) {
    if (offset + CENTRAL_FILE_HEADER_MIN_SIZE > bytes.byteLength) {
      throw new ZipGuardError("unverifiable", "truncated central directory header")
    }
    if (!matchesSignatureAt(bytes, CENTRAL_FILE_HEADER_SIGNATURE, offset)) {
      throw new ZipGuardError("unverifiable", `bad central header at entry ${i}`)
    }

    const uncompressedSize = readUint32LE(bytes, offset + 24)
    if (uncompressedSize === ZIP64_UINT32_MARKER) {
      throw new ZipGuardError("unverifiable", `ZIP64 entry size at entry ${i}`)
    }

    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new ZipGuardError(
        "limit",
        `uncompressed total exceeds ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes`
      )
    }

    const nameLength = readUint16LE(bytes, offset + 28)
    const extraLength = readUint16LE(bytes, offset + 30)
    const commentLength = readUint16LE(bytes, offset + 32)
    offset += CENTRAL_FILE_HEADER_MIN_SIZE + nameLength + extraLength + commentLength
  }
}
