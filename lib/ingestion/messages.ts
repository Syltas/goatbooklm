/**
 * German, user-facing error strings — verbatim from the Fehler-Matrix
 * (specs/02-ingestion.md §10) — plus the staleness threshold, factored out
 * of `service.ts` into their own zero-dependency module so client
 * components (Sources-Panel polling/stale-guard, AC-46) can import them
 * without pulling in `service.ts`'s Supabase-client-typed surface. Kept as
 * named constants (rather than inline literals scattered through the
 * pipeline/UI) so tests and the client stale-guard can assert on/reuse them
 * without string-duplication drift.
 */
export const INGESTION_MESSAGES = {
  pdfCorrupt:
    "PDF konnte nicht gelesen werden (beschädigt oder passwortgeschützt).",
  // Robustness fix: `extractContent`'s pdf branch used to throw `pdfCorrupt`
  // for a download/storage-layer failure too (missing `storage_path`, or
  // `downloadStorageFile` itself rejecting) — telling the user their FILE is
  // broken when actually nothing about its content was ever examined. Own
  // message, since a download failure is often transient (retry may just
  // work), unlike a genuinely corrupted/encrypted PDF.
  pdfDownloadFailed: "PDF konnte nicht heruntergeladen werden — bitte erneut versuchen.",
  pdfEmpty:
    "Kein Text im PDF gefunden — gescannte/Bild-PDFs werden ohne OCR nicht unterstützt.",
  sizeLimitExceeded: "Datei/Text überschreitet das erlaubte Limit.",

  // --- Per-format messages (multi-format ingestion) -----------------------
  // Every format gets its own download/parse/empty wording rather than
  // reusing the PDF strings. The PDF trio above showed why this matters:
  // "PDF konnte nicht gelesen werden" shown for a broken .docx tells the
  // user the wrong thing about the wrong file, and the recovery advice
  // differs per format (a scanned PDF needs OCR; an empty .xlsx needs data
  // in the cells; an image that the vision model couldn't read needs a
  // clearer photo). `FORMAT_MESSAGES` below maps a source type onto its set.
  txtDownloadFailed: "Textdatei konnte nicht heruntergeladen werden — bitte erneut versuchen.",
  txtCorrupt:
    "Textdatei konnte nicht gelesen werden — sie ist nicht UTF-8-kodiert.",
  txtEmpty: "Die Textdatei enthält keinen Text.",

  mdDownloadFailed:
    "Markdown-Datei konnte nicht heruntergeladen werden — bitte erneut versuchen.",
  mdCorrupt:
    "Markdown-Datei konnte nicht gelesen werden — sie ist nicht UTF-8-kodiert.",
  mdEmpty: "Die Markdown-Datei enthält keinen Text.",

  docxDownloadFailed:
    "Word-Dokument konnte nicht heruntergeladen werden — bitte erneut versuchen.",
  docxCorrupt:
    "Word-Dokument konnte nicht gelesen werden (beschädigt oder passwortgeschützt).",
  docxEmpty: "Kein Text im Word-Dokument gefunden.",

  xlsxDownloadFailed:
    "Excel-Tabelle konnte nicht heruntergeladen werden — bitte erneut versuchen.",
  xlsxCorrupt:
    "Excel-Tabelle konnte nicht gelesen werden (beschädigt oder passwortgeschützt).",
  xlsxEmpty: "Die Excel-Tabelle enthält keine Daten.",

  csvDownloadFailed:
    "CSV-Datei konnte nicht heruntergeladen werden — bitte erneut versuchen.",
  csvCorrupt: "CSV-Datei konnte nicht gelesen werden — sie ist nicht UTF-8-kodiert.",
  csvEmpty: "Die CSV-Datei enthält keine Daten.",

  imageDownloadFailed: "Bild konnte nicht heruntergeladen werden — bitte erneut versuchen.",
  imageCorrupt:
    "Bild konnte nicht gelesen werden — es ist kein gültiges PNG, JPEG oder WebP.",
  // Distinct from `imageCorrupt`: the file IS a valid image, the vision
  // model just produced nothing usable from it (e.g. a blank scan).
  imageEmpty:
    "Aus diesem Bild konnte keine Beschreibung erzeugt werden — bitte ein deutlicheres Bild verwenden.",
  imageVisionFailed:
    "Bild konnte nicht analysiert werden — bitte erneut versuchen.",

  // Video is refused by name, not as a generic "type not allowed": the user
  // picked a video deliberately, and needs to know it is out of scope
  // rather than assume the upload is broken.
  videoUnsupported:
    "Videos werden nicht unterstützt. Erlaubt sind PDF, Word, Excel, CSV, Text, Markdown und Bilder.",
  unsupportedFileType:
    "Dieser Dateityp wird nicht unterstützt. Erlaubt sind PDF, Word, Excel, CSV, Text, Markdown und Bilder.",
  embedFailed: "Embedding fehlgeschlagen — bitte erneut versuchen.",
  persistFailed: "Speichern der Quelle fehlgeschlagen.",
  // Robustness fix: a `createTextSource`/`createWebSource`/
  // `enqueueIngestionJob` enqueue failure used to leave the `sources` row
  // silently `pending` forever — invisible until the 10-minute client-side
  // stale-guard (`source-status.ts`) finally flagged it. Own message (not
  // `processingFailedGeneric`) since the queue, not the content, is what
  // failed — see `service.ts`'s `enqueueOrMarkFailed`.
  enqueueFailed: "Einreihen in die Warteschlange fehlgeschlagen — bitte erneut versuchen.",
  // SSRF guard (`extract.ts`'s `checkUrlSafety`) used to collapse every
  // failure mode — bad scheme, localhost/private/blocked IP, AND a
  // transient DNS/network resolution failure — into this one string. That
  // made a "DNS hiccup, retry might work" indistinguishable from a
  // deliberate security block. Split into three; `extract.ts` keeps its own
  // byte-identical copies of all three strings (not imported — see that
  // module's `SSRF_SCHEME_MESSAGE`/`SSRF_BLOCKED_MESSAGE`/`SSRF_DNS_MESSAGE`)
  // so they stay recognized by `actions.ts`'s `KNOWN_INGESTION_MESSAGES`
  // passthrough instead of collapsing to a generic fallback.
  ssrfSchemeUnsupported: "URL-Schema nicht unterstützt — nur http/https erlaubt.",
  ssrfBlocked: "Diese URL ist nicht erlaubt.",
  ssrfDnsFailed: "Adresse konnte nicht aufgelöst werden — bitte später erneut versuchen.",
  staleTimeout: "Verarbeitung abgebrochen (Timeout/Neustart).",
  // Eng-Review M2: a source stuck on status='pending' for >10min (the
  // enqueue/pickup never happened, or got lost) — distinct message from
  // `staleTimeout` (which is for a job that DID start processing and then
  // stalled) since the recovery story differs, see `stalePendingNoUpload`
  // below.
  stalePending: "Upload nicht abgeschlossen.",
  // Shown specifically when a Retry is attempted on a stale-pending PDF
  // source whose Storage object never actually finished uploading — there
  // is nothing to (re-)process, re-enqueuing would just fail again the same
  // way. The user's only path forward is a fresh upload.
  stalePendingNoUpload: "Bitte Quelle löschen und erneut hochladen.",
  processingInProgress: "Verarbeitung läuft bereits.",
  notFound: "Quelle nicht gefunden.",
  processingFailedGeneric: "Verarbeitung fehlgeschlagen.",
  noReadableText: "Kein Text gefunden.",
} as const

/**
 * Maps a file-backed source type onto its three failure messages, so
 * `extractContent` can stay format-agnostic: it resolves the set once from
 * the source's type and throws the right string at the right step, instead
 * of the old PDF-only branch that hard-coded `pdfDownloadFailed`/`pdfCorrupt`
 * /`pdfEmpty` for every format alike.
 *
 * Values are pulled from `INGESTION_MESSAGES` (rather than inlined here) so
 * every string stays a member of that flat object — `actions.ts`'s
 * `KNOWN_INGESTION_MESSAGES` passthrough is built from `Object.values` of it
 * and recognizes an error only by exact string match, so a message defined
 * outside it would silently collapse to the generic fallback.
 */
export const FORMAT_MESSAGES: Record<
  string,
  { downloadFailed: string; corrupt: string; empty: string }
> = {
  pdf: {
    downloadFailed: INGESTION_MESSAGES.pdfDownloadFailed,
    corrupt: INGESTION_MESSAGES.pdfCorrupt,
    empty: INGESTION_MESSAGES.pdfEmpty,
  },
  txt: {
    downloadFailed: INGESTION_MESSAGES.txtDownloadFailed,
    corrupt: INGESTION_MESSAGES.txtCorrupt,
    empty: INGESTION_MESSAGES.txtEmpty,
  },
  md: {
    downloadFailed: INGESTION_MESSAGES.mdDownloadFailed,
    corrupt: INGESTION_MESSAGES.mdCorrupt,
    empty: INGESTION_MESSAGES.mdEmpty,
  },
  docx: {
    downloadFailed: INGESTION_MESSAGES.docxDownloadFailed,
    corrupt: INGESTION_MESSAGES.docxCorrupt,
    empty: INGESTION_MESSAGES.docxEmpty,
  },
  xlsx: {
    downloadFailed: INGESTION_MESSAGES.xlsxDownloadFailed,
    corrupt: INGESTION_MESSAGES.xlsxCorrupt,
    empty: INGESTION_MESSAGES.xlsxEmpty,
  },
  csv: {
    downloadFailed: INGESTION_MESSAGES.csvDownloadFailed,
    corrupt: INGESTION_MESSAGES.csvCorrupt,
    empty: INGESTION_MESSAGES.csvEmpty,
  },
  image: {
    downloadFailed: INGESTION_MESSAGES.imageDownloadFailed,
    corrupt: INGESTION_MESSAGES.imageCorrupt,
    empty: INGESTION_MESSAGES.imageEmpty,
  },
}

/** Processing-without-a-status-change threshold (AC-46/OV2) — 10 minutes,
 *  deliberately identical to the worker's pgmq visibility timeout (`vt=600`,
 *  specs/02-ingestion.md §8) so the client-side stale-guard and the queue's
 *  own natural-retry window line up. */
export const STALE_PROCESSING_MS = 10 * 60 * 1000
