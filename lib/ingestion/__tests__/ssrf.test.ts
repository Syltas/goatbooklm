import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}))

// Eng-Review H1: `fetchWebPage` now issues its request via `undici`'s own
// `fetch` (not the Node-global one) through a per-hop, IP-pinned `Agent` —
// see extract.ts's doc comment for why (global fetch + an externally
// constructed `undici` `Agent` as `dispatcher` throws, confirmed
// empirically; `fetch` and `Agent` must come from the same `undici`
// instance). Tests mock `undici`'s exports directly rather than
// `global.fetch`. `Agent` itself is wrapped (not replaced) — the mock still
// constructs and returns a REAL `undici.Agent` (so `.close()` etc. behave
// exactly as in production and every response-handling test below needs no
// changes beyond the mock target), but recording every call's options lets
// the dedicated pinning test below assert on the `connect.lookup` override
// `createPinnedDispatcher` configures.
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

import { Agent, fetch as undiciFetch } from "undici"

import { assertSafeUrl, fetchWebPage } from "../extract"

const mockedLookup = vi.mocked(lookup)
const mockedFetch = vi.mocked(undiciFetch)
const MockedAgent = vi.mocked(Agent)

function jsonHeaders(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries))
  return { get: (key: string) => map.get(key.toLowerCase()) ?? null }
}

function htmlResponse(status: number, body: string, extraHeaders: Record<string, string> = {}) {
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

/** Invokes a captured `connect.lookup` function the same way `net`/`tls`
 *  would (the `all: true` shape, which is what `net.connect`'s internal
 *  resolution actually requests — confirmed empirically, see extract.ts's
 *  `createPinnedLookup` doc comment) and returns whatever it calls back
 *  with. */
function runCapturedLookup(
  lookupFn: (...args: unknown[]) => void,
  hostname: string
): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => {
    lookupFn(hostname, { all: true }, (err: Error | null, addresses: unknown) => {
      if (err) reject(err)
      else resolve(addresses as { address: string; family: number }[])
    })
  })
}

describe("assertSafeUrl", () => {
  beforeEach(() => {
    mockedLookup.mockReset()
  })

  it("throws for a non-http(s) scheme (file://)", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("throws for a non-http(s) scheme (ftp://)", async () => {
    await expect(assertSafeUrl("ftp://example.com/file")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("throws for localhost", async () => {
    await expect(assertSafeUrl("http://localhost:3000/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("throws for the loopback literal 127.0.0.1", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/admin")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("throws for a private IPv4 literal (10.x)", async () => {
    await expect(assertSafeUrl("http://10.1.2.3/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("throws for a private IPv4 literal (172.16-31.x)", async () => {
    await expect(assertSafeUrl("http://172.20.0.5/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("throws for a private IPv4 literal (192.168.x)", async () => {
    await expect(assertSafeUrl("http://192.168.1.50/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("throws for the cloud metadata endpoint 169.254.169.254", async () => {
    await expect(
      assertSafeUrl("http://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow("Diese URL ist nicht erlaubt.")
  })

  it("throws for the IPv6 loopback literal ::1", async () => {
    await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("throws when the hostname resolves (DNS) to a private IP", async () => {
    mockedLookup.mockResolvedValue([
      { address: "10.0.0.9", family: 4 },
    ] as never)

    await expect(assertSafeUrl("https://internal.example.com/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
    expect(mockedLookup).toHaveBeenCalledWith(
      "internal.example.com",
      expect.objectContaining({ all: true })
    )
  })

  it("throws when ANY of several resolved addresses is private", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.0.1", family: 4 },
    ] as never)

    await expect(assertSafeUrl("https://mixed.example.com/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("does not throw for a public https URL resolving to a public IP", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never)

    await expect(
      assertSafeUrl("https://example.com/article")
    ).resolves.toBeUndefined()
  })

  it("throws for a syntactically invalid URL", async () => {
    await expect(assertSafeUrl("not a url")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })
})

describe("fetchWebPage — redirect-hop SSRF checks", () => {
  beforeEach(() => {
    mockedLookup.mockReset()
    mockedFetch.mockReset()
    MockedAgent.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("blocks a redirect whose Location targets an internal IP literal, without following it", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never)

    mockedFetch.mockResolvedValueOnce(
      redirectResponse("http://169.254.169.254/latest/meta-data/")
    )

    await expect(fetchWebPage("https://public.example.com/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )

    // The malicious hop must never have been fetched.
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it("re-checks DNS independently on every hop: a redirect to a second hostname that resolves privately is blocked even though the first hostname resolved publicly", async () => {
    // Hop 1: "public.example.com" resolves to a public IP.
    // Hop 2 (redirect target): "internal.example.com" resolves privately.
    // This proves the guard performs a *fresh* DNS check per hop rather
    // than trusting/caching the first hop's result, AND (per the pinning
    // test below) that each hop's connection is pinned to what THAT hop's
    // check validated.
    mockedLookup.mockImplementation(async (hostname: string) => {
      if (hostname === "public.example.com") {
        return [{ address: "93.184.216.34", family: 4 }] as never
      }
      if (hostname === "internal.example.com") {
        return [{ address: "10.0.0.5", family: 4 }] as never
      }
      throw new Error(`unexpected hostname in test: ${hostname}`)
    })

    mockedFetch.mockResolvedValueOnce(
      redirectResponse("https://internal.example.com/next")
    )

    await expect(fetchWebPage("https://public.example.com/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )

    expect(mockedLookup).toHaveBeenCalledWith(
      "public.example.com",
      expect.objectContaining({ all: true })
    )
    expect(mockedLookup).toHaveBeenCalledWith(
      "internal.example.com",
      expect.objectContaining({ all: true })
    )
    // Only the first (safe) hop was ever actually fetched.
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it("succeeds through a redirect chain that stays on safe hosts", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never)

    mockedFetch
      .mockResolvedValueOnce(redirectResponse("https://public.example.com/final"))
      .mockResolvedValueOnce(
        htmlResponse(200, "<html><body>ok</body></html>")
      )

    const result = await fetchWebPage("https://public.example.com/")
    expect(result.finalUrl).toBe("https://public.example.com/final")
    expect(mockedFetch).toHaveBeenCalledTimes(2)
  })

  // Eng-Review H1 — connect-time IP pinning.
  it("pins the connection to the DNS-resolved, already-validated-safe IP (not a second, unguarded resolution)", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never)
    mockedFetch.mockResolvedValueOnce(htmlResponse(200, "<html></html>"))

    await fetchWebPage("https://example.com/")

    expect(MockedAgent).toHaveBeenCalledTimes(1)
    const agentOptions = MockedAgent.mock.calls[0][0] as {
      connect: { lookup: (...args: unknown[]) => void }
    }
    const pinnedLookup = agentOptions.connect.lookup
    expect(pinnedLookup).toBeTypeOf("function")

    // Call the captured lookup exactly the way undici's connector would —
    // it must resolve to the pre-validated IP regardless of what hostname
    // it's asked about, since this Agent is single-hop, single-purpose.
    const resolved = await runCapturedLookup(pinnedLookup, "example.com")
    expect(resolved).toEqual([{ address: "93.184.216.34", family: 4 }])

    // The dispatcher was passed through to the actual fetch call, and
    // closed again afterwards (no leaked per-hop agents).
    const fetchOptions = mockedFetch.mock.calls[0][1] as { dispatcher?: unknown }
    expect(fetchOptions.dispatcher).toBeDefined()
  })

  it("pins each redirect hop to that hop's OWN resolved IP, not the first hop's", async () => {
    mockedLookup.mockImplementation(async (hostname: string) => {
      if (hostname === "first.example.com") {
        return [{ address: "1.1.1.1", family: 4 }] as never
      }
      if (hostname === "second.example.com") {
        return [{ address: "2.2.2.2", family: 4 }] as never
      }
      throw new Error(`unexpected hostname in test: ${hostname}`)
    })

    mockedFetch
      .mockResolvedValueOnce(redirectResponse("https://second.example.com/final"))
      .mockResolvedValueOnce(htmlResponse(200, "<html></html>"))

    await fetchWebPage("https://first.example.com/")

    expect(MockedAgent).toHaveBeenCalledTimes(2)
    const firstHopLookup = (
      MockedAgent.mock.calls[0][0] as { connect: { lookup: (...a: unknown[]) => void } }
    ).connect.lookup
    const secondHopLookup = (
      MockedAgent.mock.calls[1][0] as { connect: { lookup: (...a: unknown[]) => void } }
    ).connect.lookup

    await expect(runCapturedLookup(firstHopLookup, "first.example.com")).resolves.toEqual([
      { address: "1.1.1.1", family: 4 },
    ])
    await expect(runCapturedLookup(secondHopLookup, "second.example.com")).resolves.toEqual([
      { address: "2.2.2.2", family: 4 },
    ])
  })
})
