/**
 * Minimale MP3-Werkzeuge für das Konkatenieren von ElevenLabs-Segmenten
 * (docs/specs/studio-audio.md, Review-Fix R1-7). Kein ffmpeg auf Vercel —
 * bei identischem Encoder/Bitrate (mp3_44100_128, CBR) ist Frame-Concat
 * player-kompatibel, WENN die Metadaten-Präfixe der Segmente entfernt
 * werden:
 *
 * - ID3v2-Tags mitten im Stream sind decoder-abhängig → bei Segment 2..n
 *   strippen (Segment 1 darf seinen behalten, harmlos am Dateianfang).
 * - Der Xing/Info-Frame (erster MPEG-Frame mit "Xing"/"Info"-Tag) trägt
 *   Frame-/Dauer-Angaben NUR seines eigenen Segments — im Concat reportet
 *   er die Gesamtdauer falsch und bricht Seeking. Er wird deshalb aus
 *   JEDEM Segment entfernt (auch dem ersten — ohne Info-Frame schätzen
 *   Player die Dauer aus Bytes/Bitrate, was bei CBR stimmt).
 *
 * Pure Funktionen, unit-getestet in `__tests__/mp3.test.ts`.
 */

/** Länge eines führenden ID3v2-Tags in Bytes (0 wenn keiner). */
export function id3v2Length(buf: Uint8Array): number {
  if (buf.length < 10) return 0
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0 // "ID3"
  // Bytes 6-9: synchsafe integer (7 Bits pro Byte).
  const size =
    ((buf[6] & 0x7f) << 21) |
    ((buf[7] & 0x7f) << 14) |
    ((buf[8] & 0x7f) << 7) |
    (buf[9] & 0x7f)
  const hasFooter = (buf[5] & 0x10) !== 0
  return 10 + size + (hasFooter ? 10 : 0)
}

// MPEG Audio Layer III Bitrate-Tabelle (kbps), Index = Header-Bitfeld.
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const SAMPLE_RATES_V1 = [44100, 48000, 32000, 0]
const SAMPLE_RATES_V2 = [22050, 24000, 16000, 0]
const SAMPLE_RATES_V25 = [11025, 12000, 8000, 0]

interface FrameInfo {
  length: number
  /** Byte-Offset des Xing/Info-Tags innerhalb des Frames. */
  xingOffset: number
}

/** Parst den MPEG-Frame-Header an `offset`; null wenn kein gültiger Frame. */
function parseFrame(buf: Uint8Array, offset: number): FrameInfo | null {
  if (offset + 4 > buf.length) return null
  if (buf[offset] !== 0xff || (buf[offset + 1] & 0xe0) !== 0xe0) return null

  const versionBits = (buf[offset + 1] >> 3) & 0x03 // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layerBits = (buf[offset + 1] >> 1) & 0x03 // 1 = Layer III
  if (layerBits !== 0x01) return null

  const bitrateIndex = (buf[offset + 2] >> 4) & 0x0f
  const sampleRateIndex = (buf[offset + 2] >> 2) & 0x03
  const padding = (buf[offset + 2] >> 1) & 0x01
  const channelMode = (buf[offset + 3] >> 6) & 0x03 // 3 = mono

  const isV1 = versionBits === 3
  const bitrate = (isV1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex] * 1000
  const sampleRate = (
    versionBits === 3 ? SAMPLE_RATES_V1 : versionBits === 2 ? SAMPLE_RATES_V2 : SAMPLE_RATES_V25
  )[sampleRateIndex]
  if (!bitrate || !sampleRate) return null

  const samplesPerFrame = isV1 ? 1152 : 576
  const length = Math.floor((samplesPerFrame / 8) * (bitrate / sampleRate)) + padding

  // Xing/Info sitzt nach Header (4) + Side-Info.
  const sideInfo = isV1 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17
  return { length, xingOffset: offset + 4 + sideInfo }
}

function hasTag(buf: Uint8Array, at: number, tag: string): boolean {
  if (at + tag.length > buf.length) return false
  for (let i = 0; i < tag.length; i++) {
    if (buf[at + i] !== tag.charCodeAt(i)) return false
  }
  return true
}

/**
 * Entfernt Metadaten-Präfixe eines Segments: optional den ID3v2-Tag,
 * immer einen führenden Xing/Info-Frame (siehe Modul-Doc).
 */
export function stripSegmentMetadata(
  segment: Uint8Array,
  opts: { keepId3: boolean }
): Uint8Array {
  const id3 = id3v2Length(segment)
  const offset = id3

  const frame = parseFrame(segment, offset)
  if (
    frame &&
    (hasTag(segment, frame.xingOffset, "Xing") || hasTag(segment, frame.xingOffset, "Info"))
  ) {
    // Info-Frame droppen: alles vor ihm (ID3, je nach opts) + Frame selbst.
    const audioStart = offset + frame.length
    if (opts.keepId3 && id3 > 0) {
      const result = new Uint8Array(id3 + (segment.length - audioStart))
      result.set(segment.subarray(0, id3), 0)
      result.set(segment.subarray(audioStart), id3)
      return result
    }
    return segment.subarray(audioStart)
  }

  return opts.keepId3 ? segment : segment.subarray(offset)
}

/** Konkateniert Segmente in Reihenfolge zu einer abspielbaren MP3. */
export function concatAudioSegments(segments: Uint8Array[]): Uint8Array {
  const cleaned = segments.map((segment, index) =>
    stripSegmentMetadata(segment, { keepId3: index === 0 })
  )
  const total = cleaned.reduce((sum, s) => sum + s.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const segment of cleaned) {
    out.set(segment, offset)
    offset += segment.length
  }
  return out
}
