import JSZip from "jszip"
import { describe, expect, it } from "vitest"

import {
  assertZipWithinLimits,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  ZipGuardError,
} from "../zip-guard"

// --- Byte builders for synthetic central directories -----------------------
// The guard reads ONLY the central directory + EOCD, so a test archive needs
// nothing else: we lay the central-directory headers at offset 0 followed by
// the EOCD. This lets us declare arbitrary (including malicious) uncompressed
// sizes and entry counts the way a bomb would, which a real ZIP writer would
// never emit.

function pushU16(out: number[], v: number): void {
  out.push(v & 0xff, (v >>> 8) & 0xff)
}
function pushU32(out: number[], v: number): void {
  out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
}

function buildCentralHeader(uncompressedSize: number, name = "x"): number[] {
  const nameBytes = [...new TextEncoder().encode(name)]
  const h: number[] = []
  pushU32(h, 0x02014b50) // central file header signature "PK\x01\x02"
  pushU16(h, 20) // version made by
  pushU16(h, 20) // version needed
  pushU16(h, 0) // general purpose flags
  pushU16(h, 0) // compression method (stored)
  pushU16(h, 0) // mod time
  pushU16(h, 0) // mod date
  pushU32(h, 0) // crc-32
  pushU32(h, 0) // compressed size
  pushU32(h, uncompressedSize) // uncompressed size (offset 24)
  pushU16(h, nameBytes.length) // file name length (offset 28)
  pushU16(h, 0) // extra field length (offset 30)
  pushU16(h, 0) // file comment length (offset 32)
  pushU16(h, 0) // disk number start
  pushU16(h, 0) // internal attributes
  pushU32(h, 0) // external attributes
  pushU32(h, 0) // relative offset of local header
  h.push(...nameBytes)
  return h
}

function buildSyntheticZip(
  entries: { uncompressedSize: number; name?: string }[],
  opts: { totalEntriesOverride?: number } = {}
): Uint8Array {
  const headers: number[] = []
  for (const e of entries) headers.push(...buildCentralHeader(e.uncompressedSize, e.name))

  const cdOffset = 0
  const cdSize = headers.length
  const eocd: number[] = []
  pushU32(eocd, 0x06054b50) // EOCD signature "PK\x05\x06"
  pushU16(eocd, 0) // number of this disk
  pushU16(eocd, 0) // disk where CD starts
  pushU16(eocd, entries.length) // CD records on this disk
  pushU16(eocd, opts.totalEntriesOverride ?? entries.length) // total CD records (offset 10)
  pushU32(eocd, cdSize) // size of central directory (offset 12)
  pushU32(eocd, cdOffset) // offset of central directory (offset 16)
  pushU16(eocd, 0) // comment length

  return new Uint8Array([...headers, ...eocd])
}

describe("assertZipWithinLimits", () => {
  it("passes a real, small ZIP (built by JSZip)", async () => {
    const zip = new JSZip()
    zip.file("a.txt", "hallo")
    zip.file("nested/b.txt", "welt")
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }))

    expect(() => assertZipWithinLimits(bytes)).not.toThrow()
  })

  it("passes a synthetic ZIP whose declared uncompressed total is within the bound", () => {
    const bytes = buildSyntheticZip([
      { uncompressedSize: 1000, name: "one" },
      { uncompressedSize: 2000, name: "two" },
    ])
    expect(() => assertZipWithinLimits(bytes)).not.toThrow()
  })

  it("rejects (limit) when the summed uncompressed size exceeds the bound", () => {
    const bytes = buildSyntheticZip([
      { uncompressedSize: MAX_ZIP_UNCOMPRESSED_BYTES - 10 },
      { uncompressedSize: 100 }, // pushes the running total over the limit
    ])
    try {
      assertZipWithinLimits(bytes)
      throw new Error("expected assertZipWithinLimits to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ZipGuardError)
      expect((err as ZipGuardError).reason).toBe("limit")
    }
  })

  it("rejects (limit) when a single entry alone is a decompression bomb", () => {
    // Above the 500 MB cap — a real single-entry bomb is far larger still.
    const bytes = buildSyntheticZip([{ uncompressedSize: 600 * 1024 * 1024 }])
    expect(() => assertZipWithinLimits(bytes)).toThrow(ZipGuardError)
  })

  it("rejects (limit) when the declared entry count exceeds the cap", () => {
    // Declared total far over the cap — rejected before any header is walked.
    const bytes = buildSyntheticZip([{ uncompressedSize: 1 }], {
      totalEntriesOverride: MAX_ZIP_ENTRIES + 1,
    })
    try {
      assertZipWithinLimits(bytes)
      throw new Error("expected assertZipWithinLimits to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ZipGuardError)
      expect((err as ZipGuardError).reason).toBe("limit")
    }
  })

  it("fails closed (unverifiable) on a ZIP64 uncompressed-size marker", () => {
    const bytes = buildSyntheticZip([{ uncompressedSize: 0xffffffff }])
    try {
      assertZipWithinLimits(bytes)
      throw new Error("expected assertZipWithinLimits to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ZipGuardError)
      expect((err as ZipGuardError).reason).toBe("unverifiable")
    }
  })

  it("fails closed (unverifiable) when no end-of-central-directory record is present", () => {
    const notAZip = new TextEncoder().encode("überhaupt kein zip, nur text")
    try {
      assertZipWithinLimits(notAZip)
      throw new Error("expected assertZipWithinLimits to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ZipGuardError)
      expect((err as ZipGuardError).reason).toBe("unverifiable")
    }
  })

  it("fails closed (unverifiable) on a too-short buffer", () => {
    expect(() => assertZipWithinLimits(new Uint8Array([0x50, 0x4b]))).toThrow(
      ZipGuardError
    )
  })

  it("fails closed (unverifiable) when a central-directory header signature is wrong", () => {
    // Valid EOCD pointing at a central directory whose first header signature
    // is corrupt — the walk must reject rather than trust the declared count.
    const bytes = buildSyntheticZip([{ uncompressedSize: 10 }])
    bytes[1] = 0x00 // clobber the "PK\x01\x02" signature's second byte
    try {
      assertZipWithinLimits(bytes)
      throw new Error("expected assertZipWithinLimits to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ZipGuardError)
      expect((err as ZipGuardError).reason).toBe("unverifiable")
    }
  })
})
