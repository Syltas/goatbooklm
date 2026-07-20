/**
 * Builds a minimal, byte-accurate, real PDF (own xref table computed from
 * actual object offsets — not a template with placeholder offsets) with one
 * page of extractable text, entirely in memory. Used by
 * `e2e/sources/pdf-upload.spec.ts` via Playwright's `setInputFiles({ name,
 * mimeType, buffer })` — no fixture file ever touches disk/the repo, so
 * there is nothing to clean up afterwards.
 *
 * Verified against the real `unpdf` extractor (the same one
 * `lib/ingestion/extract.ts` uses in production) before being wired into
 * the E2E suite — `getDocumentProxy` + `extractText` successfully recover
 * the exact input string back out of a PDF built this way.
 */
export function buildMinimalPdf(text: string): Buffer {
  const escaped = text.replace(/([()\\])/g, "\\$1")

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 200] /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ]
  const stream = `BT /F1 18 Tf 20 100 Td (${escaped}) Tj ET`
  objects.push(
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`
  )

  let body = "%PDF-1.4\n"
  const offsets: number[] = [0] // object 0 is the free-list head, offset unused
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"))
    body += obj
  }

  const xrefStart = Buffer.byteLength(body, "latin1")
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    xref += `${offsets[i].toString().padStart(10, "0")} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

  return Buffer.from(body + xref + trailer, "latin1")
}
