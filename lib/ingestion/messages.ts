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
  pdfEmpty:
    "Kein Text im PDF gefunden — gescannte/Bild-PDFs werden ohne OCR nicht unterstützt.",
  sizeLimitExceeded: "Datei/Text überschreitet das erlaubte Limit.",
  embedFailed: "Embedding fehlgeschlagen — bitte erneut versuchen.",
  persistFailed: "Speichern der Quelle fehlgeschlagen.",
  ssrfBlocked: "Diese URL ist nicht erlaubt.",
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

/** Processing-without-a-status-change threshold (AC-46/OV2) — 10 minutes,
 *  deliberately identical to the worker's pgmq visibility timeout (`vt=600`,
 *  specs/02-ingestion.md §8) so the client-side stale-guard and the queue's
 *  own natural-retry window line up. */
export const STALE_PROCESSING_MS = 10 * 60 * 1000
