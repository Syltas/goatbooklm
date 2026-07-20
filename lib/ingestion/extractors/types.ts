import type { PageOffset } from "../extract"

/**
 * The one shape every extraction head implements. Replaces the previous
 * `IngestionDeps.extractPdfText` named field: with a format registry the
 * service no longer knows which formats exist, it just looks the head up by
 * source type (`IngestionDeps.fileExtractors`), so all heads have to be
 * interchangeable at the type level.
 */
export interface FileExtractorInput {
  bytes: Uint8Array
  /** Original upload name — the image head derives its media type from the
   *  extension, and it makes a better error/log context than a UUID path. */
  fileName: string
}

export interface FileExtraction {
  text: string
  /** Only PDFs carry per-page char ranges (used for `chunks.metadata.page`).
   *  Every other format omits it, and `buildChunkMetadata` skips the page
   *  attribution accordingly. */
  pageOffsets?: PageOffset[]
}

export type FileExtractor = (input: FileExtractorInput) => Promise<FileExtraction>
