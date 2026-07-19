import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}))

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}))

// Eng-Review H1: see ssrf.test.ts's identical mock for why `fetchWebPage`'s
// network layer is mocked via `undici`'s own exports rather than
// `global.fetch` — it now issues requests through `undici`'s `fetch` plus a
// per-hop IP-pinned `Agent`, and global `fetch` + an externally constructed
// `undici` `Agent` as `dispatcher` don't interoperate.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>()
  return {
    ...actual,
    fetch: vi.fn(),
    // Must be a regular `function`, not an arrow function — `new Agent(...)`
    // (extract.ts's `createPinnedDispatcher`) constructs this mock, and
    // arrow functions can't be used as constructors.
    Agent: vi
      .fn()
      .mockImplementation(function (options: ConstructorParameters<typeof actual.Agent>[0]) {
        return new actual.Agent(options)
      }),
  }
})

import { lookup } from "node:dns/promises"
import { extractText, getDocumentProxy } from "unpdf"

import { fetch as undiciFetch } from "undici"

import { extractPdfText, extractWebText, fetchWebPage } from "../extract"

const mockedLookup = vi.mocked(lookup)
const mockedGetDocumentProxy = vi.mocked(getDocumentProxy)
const mockedExtractText = vi.mocked(extractText)
const mockedFetch = vi.mocked(undiciFetch)

function jsonHeaders(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries))
  return { get: (key: string) => map.get(key.toLowerCase()) ?? null }
}

function htmlResponse(
  status: number,
  body: string,
  extraHeaders: Record<string, string> = {}
) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: jsonHeaders({ "content-type": "text/html", ...extraHeaders }),
    text: async () => body,
    body: null,
  } as unknown as Awaited<ReturnType<typeof undiciFetch>>
}

function redirectResponse(location: string) {
  return {
    status: 302,
    ok: false,
    headers: jsonHeaders({ location }),
    text: async () => "",
    body: null,
  } as unknown as Awaited<ReturnType<typeof undiciFetch>>
}

function streamedResponse(chunks: Uint8Array[], contentType = "text/html") {
  let i = 0
  return {
    status: 200,
    ok: true,
    headers: jsonHeaders({ "content-type": contentType }),
    text: async () => "",
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) return { done: false, value: chunks[i++] }
          return { done: true, value: undefined }
        },
        cancel: async () => {},
        releaseLock: () => {},
      }),
    },
  } as unknown as Awaited<ReturnType<typeof undiciFetch>>
}

describe("extractPdfText", () => {
  beforeEach(() => {
    mockedGetDocumentProxy.mockReset()
    mockedExtractText.mockReset()
  })

  it("joins pages with \\n\\n and records exact per-page char offsets", async () => {
    mockedGetDocumentProxy.mockResolvedValue({} as never)
    mockedExtractText.mockResolvedValue({
      totalPages: 3,
      text: ["Erste Seite.", "Zweite Seite.", "Dritte Seite."],
    } as never)

    const result = await extractPdfText(new Uint8Array([1, 2, 3]))

    const expectedText = "Erste Seite.\n\nZweite Seite.\n\nDritte Seite."
    expect(result.text).toBe(expectedText)
    expect(result.pageOffsets).toEqual([
      { page: 1, charStart: 0, charEnd: 12 },
      { page: 2, charStart: 14, charEnd: 27 },
      { page: 3, charStart: 29, charEnd: 42 },
    ])

    for (const { page, charStart, charEnd } of result.pageOffsets) {
      const pageText = ["Erste Seite.", "Zweite Seite.", "Dritte Seite."][
        page - 1
      ]
      expect(expectedText.slice(charStart, charEnd)).toBe(pageText)
    }
  })

  it("handles a single-page PDF with no separator needed", async () => {
    mockedGetDocumentProxy.mockResolvedValue({} as never)
    mockedExtractText.mockResolvedValue({
      totalPages: 1,
      text: ["Nur eine Seite."],
    } as never)

    const result = await extractPdfText(new Uint8Array([1]))
    expect(result.text).toBe("Nur eine Seite.")
    expect(result.pageOffsets).toEqual([{ page: 1, charStart: 0, charEnd: 15 }])
  })

  it("returns empty text for a PDF with no extractable pages (image-only)", async () => {
    mockedGetDocumentProxy.mockResolvedValue({} as never)
    mockedExtractText.mockResolvedValue({
      totalPages: 2,
      text: ["", ""],
    } as never)

    const result = await extractPdfText(new Uint8Array([1]))
    expect(result.text.trim()).toBe("")
  })

  it("propagates a rejection from a corrupted/encrypted PDF", async () => {
    mockedGetDocumentProxy.mockRejectedValue(new Error("Invalid PDF structure"))

    await expect(extractPdfText(new Uint8Array([0]))).rejects.toThrow()
  })
})

describe("extractWebText", () => {
  it("extracts the main article text and title, stripping nav/boilerplate", () => {
    const html = `<!doctype html>
<html><head><title>Beispielartikel</title></head>
<body>
  <nav>Navigation-Link Navigation-Link Navigation-Link</nav>
  <article>
    <h1>Beispielartikel</h1>
    <p>${"Dies ist ein ausreichend langer Absatz mit echtem Inhalt für Readability, damit der Artikel-Erkennungsalgorithmus ihn als Hauptinhalt erkennt und nicht als Navigations-Rauschen verwirft. ".repeat(3)}</p>
  </article>
  <footer>Footer-Link Footer-Link Footer-Link</footer>
</body></html>`

    const result = extractWebText(html, "https://example.com/article")
    expect(result.title).toBe("Beispielartikel")
    expect(result.text.length).toBeGreaterThan(50)
    expect(result.text).toContain("ausreichend langer Absatz")
  })

  it("throws when the extracted main text is under 50 characters", () => {
    const html = "<html><head><title>Leer</title></head><body><p>Zu kurz.</p></body></html>"
    expect(() => extractWebText(html, "https://example.com/")).toThrow(
      "Kein lesbarer Inhalt auf dieser Seite gefunden."
    )
  })

  it("returns no title when the document has none", () => {
    const longParagraph = "Ein langer Textabsatz ohne Titel-Tag im Dokument, der trotzdem ausreichend Inhalt für Readability liefert, damit er als Artikel erkannt wird. ".repeat(3)
    const html = `<html><body><article><p>${longParagraph}</p></article></body></html>`
    const result = extractWebText(html, "https://example.com/")
    expect(result.text.length).toBeGreaterThan(50)
  })
})

describe("fetchWebPage", () => {
  beforeEach(() => {
    mockedLookup.mockReset()
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never)
    mockedFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns html + finalUrl on a direct 200 text/html response", async () => {
    mockedFetch.mockResolvedValueOnce(htmlResponse(200, "<html></html>"))

    const result = await fetchWebPage("https://example.com/")
    expect(result.html).toBe("<html></html>")
    expect(result.finalUrl).toBe("https://example.com/")
  })

  it("throws a 404-specific message on a non-ok status", async () => {
    mockedFetch.mockResolvedValueOnce(htmlResponse(404, "not found"))

    await expect(fetchWebPage("https://example.com/missing")).rejects.toThrow(
      "Seite nicht erreichbar (404)."
    )
  })

  it("throws when the content-type is not text/html", async () => {
    mockedFetch.mockResolvedValueOnce(
      htmlResponse(200, "%PDF-1.4", { "content-type": "application/pdf" })
    )

    await expect(fetchWebPage("https://example.com/file.pdf")).rejects.toThrow(
      "Kein lesbarer Inhalt auf dieser Seite gefunden."
    )
  })

  it("aborts and throws a timeout-specific message when the request hangs", async () => {
    mockedFetch.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit)?.signal
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted")
          err.name = "AbortError"
          reject(err)
        })
      }) as ReturnType<typeof undiciFetch>
    })

    await expect(
      fetchWebPage("https://slow.example.com/", { timeoutMs: 5 })
    ).rejects.toThrow("Zeitüberschreitung beim Laden der Seite.")
  })

  it("throws when the streamed body exceeds maxBytes", async () => {
    const bigChunk = new Uint8Array(50)
    mockedFetch.mockResolvedValueOnce(streamedResponse([bigChunk, bigChunk]))

    await expect(
      fetchWebPage("https://example.com/big", { maxBytes: 60 })
    ).rejects.toThrow("Seite ist zu groß.")
  })

  it("throws after exceeding maxRedirects", async () => {
    mockedFetch.mockResolvedValue(redirectResponse("https://example.com/loop"))

    await expect(
      fetchWebPage("https://example.com/", { maxRedirects: 2 })
    ).rejects.toThrow("Zu viele Weiterleitungen.")
    // hop 0,1,2 = 3 fetch calls before giving up on the 3rd redirect.
    expect(mockedFetch).toHaveBeenCalledTimes(3)
  })

  it("rejects a redirect response with no Location header", async () => {
    mockedFetch.mockResolvedValueOnce({
      status: 302,
      ok: false,
      headers: jsonHeaders({}),
      text: async () => "",
      body: null,
    } as unknown as Awaited<ReturnType<typeof undiciFetch>>)

    await expect(fetchWebPage("https://example.com/")).rejects.toThrow(
      "Seite nicht erreichbar (ungültige Weiterleitung)."
    )
  })
})
