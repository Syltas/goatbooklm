import { describe, expect, it } from "vitest"

import { concatAudioSegments, id3v2Length, stripSegmentMetadata } from "../mp3"

/** Synthetischer ID3v2-Tag: 10 Byte Header + `size` Byte Body. */
function id3(size: number): Uint8Array {
  const tag = new Uint8Array(10 + size)
  tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]) // "ID3", v2.3, keine Flags
  tag[6] = (size >> 21) & 0x7f
  tag[7] = (size >> 14) & 0x7f
  tag[8] = (size >> 7) & 0x7f
  tag[9] = size & 0x7f
  return tag
}

/** MPEG1 Layer III, 128 kbps, 44100 Hz, Stereo → 417-Byte-Frame. */
function frame(withXing: boolean, fill: number): Uint8Array {
  const f = new Uint8Array(417).fill(fill)
  f.set([0xff, 0xfb, 0x90, 0x00])
  if (withXing) {
    // Xing-Tag sitzt bei Header(4) + Side-Info Stereo MPEG1(32) = 36.
    f.set([0x58, 0x69, 0x6e, 0x67], 36) // "Xing"
  }
  return f
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

describe("id3v2Length", () => {
  it("misst einen Tag inklusive synchsafe Size", () => {
    expect(id3v2Length(id3(100))).toBe(110)
  })
  it("0 ohne Tag", () => {
    expect(id3v2Length(frame(false, 1))).toBe(0)
  })
})

describe("stripSegmentMetadata", () => {
  it("entfernt ID3 + Xing-Frame bei keepId3=false", () => {
    const audio = frame(false, 7)
    const segment = concatBytes(id3(50), frame(true, 0), audio)
    const stripped = stripSegmentMetadata(segment, { keepId3: false })
    expect(stripped).toEqual(audio)
  })

  it("behält ID3, droppt aber den Xing-Frame bei keepId3=true", () => {
    const tag = id3(20)
    const audio = frame(false, 9)
    const segment = concatBytes(tag, frame(true, 0), audio)
    const stripped = stripSegmentMetadata(segment, { keepId3: true })
    expect(stripped.length).toBe(tag.length + audio.length)
    expect(stripped.subarray(0, tag.length)).toEqual(tag)
  })

  it("lässt Segmente ohne Xing-Frame (bis auf ID3) unangetastet", () => {
    const audio = concatBytes(frame(false, 3), frame(false, 4))
    expect(stripSegmentMetadata(audio, { keepId3: false })).toEqual(audio)
  })
})

describe("concatAudioSegments", () => {
  it("konkateniert: Segment 1 behält ID3, alle verlieren Xing", () => {
    const tag = id3(10)
    const a = frame(false, 1)
    const b = frame(false, 2)
    const seg1 = concatBytes(tag, frame(true, 0), a)
    const seg2 = concatBytes(id3(30), frame(true, 0), b)
    const result = concatAudioSegments([seg1, seg2])
    expect(result).toEqual(concatBytes(tag, a, b))
  })
})
