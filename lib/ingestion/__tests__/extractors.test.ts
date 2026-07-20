import ExcelJS from "exceljs"
import JSZip from "jszip"
import { describe, expect, it, vi } from "vitest"

import { extractCsv, detectDelimiter, parseCsv } from "../extractors/csv"
import { extractDocx } from "../extractors/docx"
import { createExtractImage, imageMediaType } from "../extractors/image"
import { toMarkdownTable } from "../extractors/markdown-table"
import { extractPlainText } from "../extractors/plain-text"
import { cellToText, extractXlsx } from "../extractors/xlsx"

const encode = (text: string) => new TextEncoder().encode(text)

describe("extractPlainText (.txt / .md)", () => {
  it("decodes UTF-8 text as-is, including non-ASCII", () => {
    return expect(
      extractPlainText({ bytes: encode("Grüße aus Köln — 100 %"), fileName: "a.txt" })
    ).resolves.toEqual({ text: "Grüße aus Köln — 100 %" })
  })

  it("strips a UTF-8 BOM so citation offsets are not shifted by one", async () => {
    const { text } = await extractPlainText({
      bytes: encode("﻿Erste Zeile"),
      fileName: "a.md",
    })
    expect(text).toBe("Erste Zeile")
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it("rejects invalid UTF-8 instead of silently producing replacement chars", async () => {
    // A binary file that slipped through must fail loudly. Decoding it
    // leniently would store a chunk of U+FFFD that embeds "successfully" —
    // a silently corrupt source is worse than a visible error.
    const invalid = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x81])
    await expect(
      extractPlainText({ bytes: invalid, fileName: "a.txt" })
    ).rejects.toThrow()
  })
})

describe("parseCsv", () => {
  it("parses quoted fields with embedded delimiters, quotes and newlines", () => {
    const csv = 'a,"b,mit Komma","c ""zitiert""","d\nmit Umbruch"'
    expect(parseCsv(csv)).toEqual([
      ["a", "b,mit Komma", 'c "zitiert"', "d\nmit Umbruch"],
    ])
  })

  it("handles CRLF and a missing trailing newline", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ])
  })

  it("does not emit a spurious trailing row for a file ending in a newline", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ])
  })
})

describe("detectDelimiter", () => {
  it("detects the semicolon German Excel exports use", () => {
    // Parsing these with a comma yields one column per row, i.e. a table
    // that is technically valid and completely useless.
    expect(detectDelimiter("Name;Ort;Datum\nA;B;C")).toBe(";")
  })

  it("defaults to comma", () => {
    expect(detectDelimiter("Name,Ort,Datum")).toBe(",")
  })

  it("detects tab-separated exports", () => {
    expect(detectDelimiter("Name\tOrt\tDatum")).toBe("\t")
  })
})

describe("extractCsv", () => {
  it("serializes a CSV as a Markdown table with a header row", async () => {
    const { text } = await extractCsv({
      bytes: encode("Kunde,Betrag,Datum\nLegienhof,4711,2026-03-01\nVZUG,120,2026-03-02"),
      fileName: "umsatz.csv",
    })

    expect(text).toBe(
      [
        "| Kunde | Betrag | Datum |",
        "| --- | --- | --- |",
        "| Legienhof | 4711 | 2026-03-01 |",
        "| VZUG | 120 | 2026-03-02 |",
      ].join("\n")
    )
  })

  it("escapes pipes so a cell cannot break the table into extra columns", async () => {
    const { text } = await extractCsv({
      bytes: encode('Feld\n"a|b"'),
      fileName: "x.csv",
    })
    expect(text).toContain("a\\|b")
  })
})

describe("toMarkdownTable", () => {
  it("pads ragged rows so the pipe counts line up", () => {
    // Real spreadsheets omit trailing empty cells; an unpadded short row
    // renders as a broken table in GFM.
    expect(toMarkdownTable([["a", "b", "c"], ["x"]])).toBe(
      ["| a | b | c |", "| --- | --- | --- |", "| x |  |  |"].join("\n")
    )
  })

  it("returns an empty string for a grid with no content", () => {
    expect(toMarkdownTable([])).toBe("")
    expect(toMarkdownTable([["", "  "]])).toBe("")
  })

  it("flattens in-cell newlines to <br> rather than breaking the row", () => {
    expect(toMarkdownTable([["h"], ["a\nb"]])).toContain("a<br>b")
  })
})

describe("cellToText", () => {
  it("uses a formula's cached result, never the formula source", () => {
    // `=SUM(B2:B9)` in a chunk is noise; `1234` is the answer a query wants.
    expect(cellToText({ formula: "SUM(B2:B9)", result: 1234 })).toBe("1234")
  })

  it("renders a date as an ISO date, not an Excel serial number", () => {
    expect(cellToText(new Date(Date.UTC(2026, 2, 1)))).toBe("2026-03-01")
  })

  it("unwraps hyperlink and rich-text cells instead of stringifying the object", () => {
    expect(cellToText({ text: "Legienhof", hyperlink: "https://example.com" })).toBe(
      "Legienhof"
    )
    expect(cellToText({ richText: [{ text: "Teil " }, { text: "eins" }] })).toBe(
      "Teil eins"
    )
  })

  it("surfaces an error cell's code and maps blanks to an empty string", () => {
    expect(cellToText({ error: "#REF!" })).toBe("#REF!")
    expect(cellToText(null)).toBe("")
    expect(cellToText(undefined)).toBe("")
  })
})

/** Builds a real .xlsx in memory via ExcelJS, so the head is exercised
 *  against genuine OOXML rather than a hand-mocked workbook. */
async function buildXlsx(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()

  const first = workbook.addWorksheet("Umsatz")
  first.addRow(["Kunde", "Betrag"])
  first.addRow(["Legienhof", 4711])
  first.addRow(["VZUG", 120])

  const second = workbook.addWorksheet("Notizen")
  second.addRow(["Thema", "Status"])
  second.addRow(["Angebot", "offen"])

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}

describe("extractXlsx", () => {
  it("serializes every sheet as its own Markdown table under a heading", async () => {
    const { text } = await extractXlsx({
      bytes: await buildXlsx(),
      fileName: "umsatz.xlsx",
    })

    // The sheet heading is what keeps a mid-workbook chunk attributable —
    // without it a retrieved row says nothing about which sheet it is from.
    expect(text).toContain("## Umsatz")
    expect(text).toContain("## Notizen")
    expect(text).toContain("| Kunde | Betrag |")
    expect(text).toContain("| Legienhof | 4711 |")
    expect(text).toContain("| Angebot | offen |")
  })
})

/** Builds a minimal but structurally real .docx (OOXML in a ZIP), which is
 *  what `mammoth` actually parses — a fake buffer would only test the mock. */
async function buildDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip()

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  )

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  )

  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join("")

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}</w:body>
</w:document>`
  )

  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }))
}

describe("extractDocx", () => {
  it("extracts paragraph text from a real .docx package", async () => {
    const { text } = await extractDocx({
      bytes: await buildDocx([
        "Briefing Legienhof",
        "Termin am 1. März 2026 mit Herrn Müller.",
      ]),
      fileName: "briefing.docx",
    })

    expect(text).toContain("Briefing Legienhof")
    expect(text).toContain("Termin am 1. März 2026 mit Herrn Müller.")
    // Plain text, not HTML — tags would embed as noise and show literally
    // in the reader.
    expect(text).not.toContain("<")
  })

  it("collapses runs of empty paragraphs rather than spending chunk budget on them", async () => {
    const { text } = await extractDocx({
      bytes: await buildDocx(["Erster", "", "", "", "Zweiter"]),
      fileName: "x.docx",
    })
    expect(text).not.toMatch(/\n{3,}/)
  })

  it("rejects a non-docx buffer (the corrupt-file path)", async () => {
    await expect(
      extractDocx({ bytes: encode("überhaupt kein docx"), fileName: "x.docx" })
    ).rejects.toThrow()
  })
})

describe("image head", () => {
  it("derives the media type from the file extension", () => {
    expect(imageMediaType("a.png")).toBe("image/png")
    expect(imageMediaType("a.JPG")).toBe("image/jpeg")
    expect(imageMediaType("a.jpeg")).toBe("image/jpeg")
    expect(imageMediaType("a.webp")).toBe("image/webp")
  })

  it("sends the image bytes plus its media type in one vision call and returns the text", async () => {
    // Stubbed model — the head must be unit-testable without a real
    // Anthropic call, same convention as `createEmbedChunks`.
    const doGenerate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "  Ein Balkendiagramm.\n\nText im Bild: Umsatz  " }],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      warnings: [],
    })

    const model = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "test-vision",
      supportedUrls: {},
      doGenerate,
      doStream: vi.fn(),
    }

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const extractImage = createExtractImage(
      model as unknown as Parameters<typeof createExtractImage>[0]
    )

    const { text } = await extractImage({ bytes, fileName: "diagramm.png" })

    // Result is trimmed and becomes `content_text` verbatim — it then runs
    // through the identical chunk/embed path as every other format.
    expect(text).toBe("Ein Balkendiagramm.\n\nText im Bild: Umsatz")

    const prompt = doGenerate.mock.calls[0][0].prompt
    const userContent = prompt[0].content
    const imagePart = userContent.find(
      (part: { type: string }) => part.type === "file" || part.type === "image"
    )
    expect(imagePart.mediaType).toBe("image/png")
  })
})
