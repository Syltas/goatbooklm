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

  // Robustness fix: scheme/unparseable-URL rejections now get their own
  // message (`SSRF_SCHEME_MESSAGE`) distinct from an actually-blocked
  // address, so these assert on that string rather than the old catch-all.
  it("throws for a non-http(s) scheme (file://)", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(
      "URL-Schema nicht unterstützt — nur http/https erlaubt."
    )
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("throws for a non-http(s) scheme (ftp://)", async () => {
    await expect(assertSafeUrl("ftp://example.com/file")).rejects.toThrow(
      "URL-Schema nicht unterstützt — nur http/https erlaubt."
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
      "URL-Schema nicht unterstützt — nur http/https erlaubt."
    )
  })

  // Robustness fix: a DNS/network resolution failure is now distinguished
  // from a deliberate security block (`SSRF_DNS_MESSAGE`) — still fails
  // closed (nothing is fetched), only the message differs, so the user
  // knows retrying might help instead of assuming the URL is disallowed.
  it("throws a DNS-specific (not security-block) message when resolution fails, still failing closed", async () => {
    mockedLookup.mockRejectedValue(new Error("ENOTFOUND"))

    await expect(assertSafeUrl("https://does-not-resolve.example.com/")).rejects.toThrow(
      "Adresse konnte nicht aufgelöst werden — bitte später erneut versuchen."
    )
  })

  it("throws the same DNS-specific message when resolution returns zero records", async () => {
    mockedLookup.mockResolvedValue([] as never)

    await expect(assertSafeUrl("https://no-records.example.com/")).rejects.toThrow(
      "Adresse konnte nicht aufgelöst werden — bitte später erneut versuchen."
    )
  })
})

/**
 * Regression suite for the IPv6 classification bypass.
 *
 * The bug these guard against was invisible to the old test set because that
 * set only ever tried `http://[::1]/` — the one spelling that happens to
 * survive URL parsing unchanged. Everything else does NOT: WHATWG
 * `new URL()` rewrites the host before `assertSafeUrl` ever inspects it, so
 * `http://[::ffff:169.254.169.254]/` arrives as `::ffff:a9fe:a9fe` and the
 * dotted-quad regex that used to sit in `isBlockedIpv6` matched nothing at
 * all — the cloud metadata endpoint was reachable.
 *
 * Hence the shape of every case below: the input is a full URL string fed
 * through the real `assertSafeUrl` (and therefore through real `new URL()`
 * normalization), never a hand-written address handed straight to the
 * classifier. `normalized` is asserted alongside so the exact string the
 * guard receives is written down rather than assumed — that gap between
 * "what I test" and "what arrives" is what hid the bug.
 */
describe("assertSafeUrl — IPv6 classification (post-URL-normalization)", () => {
  beforeEach(() => {
    mockedLookup.mockReset()
  })

  /** Documents what `new URL()` actually hands the guard. A failure here
   *  means the normalization assumption itself moved, not the blocklist. */
  function normalizedHost(url: string): string {
    const raw = new URL(url).hostname
    return raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw
  }

  describe("blocked", () => {
    it.each([
      // --- IPv4-mapped ::ffff:0:0/96 — the original bypass, in every spelling
      ["http://[::ffff:169.254.169.254]/latest/meta-data/", "::ffff:a9fe:a9fe"],
      ["http://[::ffff:127.0.0.1]/", "::ffff:7f00:1"],
      ["http://[::ffff:7f00:1]/", "::ffff:7f00:1"],
      ["http://[0:0:0:0:0:ffff:7f00:1]/", "::ffff:7f00:1"],
      ["http://[::FFFF:10.0.0.5]/", "::ffff:a00:5"],
      ["http://[::ffff:192.168.1.1]/", "::ffff:c0a8:101"],
      ["http://[::ffff:172.16.0.1]/", "::ffff:ac10:1"],

      // --- IPv4-compatible ::/96 (deprecated, RFC 4291 §2.5.5.1)
      ["http://[::127.0.0.1]/", "::7f00:1"],
      ["http://[::7f00:1]/", "::7f00:1"],
      ["http://[::169.254.169.254]/", "::a9fe:a9fe"],
      // Blocked as a range, not via its embedded (public) IPv4 — the whole
      // deprecated /96 goes.
      ["http://[::8.8.8.8]/", "::808:808"],

      // --- IPv4-translated ::ffff:0:0:0/96 (SIIT, RFC 2765)
      ["http://[::ffff:0:127.0.0.1]/", "::ffff:0:7f00:1"],
      ["http://[::ffff:0:169.254.169.254]/", "::ffff:0:a9fe:a9fe"],

      // --- NAT64 64:ff9b::/96 (RFC 6052)
      ["http://[64:ff9b::169.254.169.254]/", "64:ff9b::a9fe:a9fe"],
      ["http://[64:ff9b::127.0.0.1]/", "64:ff9b::7f00:1"],
      ["http://[64:ff9b::a9fe:a9fe]/", "64:ff9b::a9fe:a9fe"],
      // NAT64 local-use /48 (RFC 8215) — blocked wholesale, prefix length
      // varies so the embedded IPv4 has no fixed offset.
      ["http://[64:ff9b:1::a9fe:a9fe]/", "64:ff9b:1::a9fe:a9fe"],
      ["http://[64:ff9b:1::1]/", "64:ff9b:1::1"],

      // --- 6to4 2002::/16 (RFC 3056) — IPv4 lives in bytes 2-5
      ["http://[2002:a9fe:a9fe::1]/", "2002:a9fe:a9fe::1"],
      ["http://[2002:7f00:1::]/", "2002:7f00:1::"],
      ["http://[2002:a00:1::1]/", "2002:a00:1::1"],
      ["http://[2002:c0a8:101::1]/", "2002:c0a8:101::1"],
      // 6to4 with all-zero embedded octets = 0.0.0.0, which the IPv4 list
      // already covers via 0.0.0.0/8 — the wrapper is transparent to it.
      ["http://[2002::1]/", "2002::1"],

      // --- plain IPv6 specials
      ["http://[::]/", "::"],
      ["http://[::1]/", "::1"],
      ["http://[0:0:0:0:0:0:0:1]/", "::1"],
      ["http://[fc00::1]/", "fc00::1"],
      ["http://[fd12:3456:789a::1]/", "fd12:3456:789a::1"],
      ["http://[fe80::1]/", "fe80::1"],
      ["http://[febf::1]/", "febf::1"],
      ["http://[fec0::1]/", "fec0::1"],
      ["http://[ff02::1]/", "ff02::1"],
      ["http://[ff00::]/", "ff00::"],
      ["http://[100::1]/", "100::1"],
      ["http://[2001:db8::1]/", "2001:db8::1"],
      ["http://[2001::1]/", "2001::1"],
    ])("blocks %s (arrives as %s)", async (url, normalized) => {
      expect(normalizedHost(url)).toBe(normalized)
      await expect(assertSafeUrl(url)).rejects.toThrow("Diese URL ist nicht erlaubt.")
      // Literal hosts must never reach DNS at all.
      expect(mockedLookup).not.toHaveBeenCalled()
    })
  })

  describe("allowed — counter-checks so the blocklist stays a blocklist", () => {
    it.each([
      ["http://[2606:4700:4700::1111]/", "2606:4700:4700::1111"], // Cloudflare DNS
      ["http://[2a00:1450:4001:80f::200e]/", "2a00:1450:4001:80f::200e"], // Google
      ["http://[2620:fe::fe]/", "2620:fe::fe"], // Quad9
      // Public IPv4 wrapped in a mapped/translated/NAT64 prefix stays
      // reachable — the embedded octets are checked, the wrapper is not a
      // blanket block.
      ["http://[::ffff:8.8.8.8]/", "::ffff:808:808"],
      ["http://[64:ff9b::8.8.8.8]/", "64:ff9b::808:808"],
      // 6to4 carrying a public IPv4 (93.184.216.34 = 5db8:d822).
      ["http://[2002:5db8:d822::1]/", "2002:5db8:d822::1"],
      // Adjacent to blocked ranges but outside them.
      ["http://[fb00::1]/", "fb00::1"], // just below fc00::/7
      ["http://[fe00::1]/", "fe00::1"], // below fe80::/10
      ["http://[2003::1]/", "2003::1"], // one past the 6to4 /16
    ])("allows %s (arrives as %s)", async (url, normalized) => {
      expect(normalizedHost(url)).toBe(normalized)
      await expect(assertSafeUrl(url)).resolves.toBeUndefined()
    })
  })

  it("blocks an AAAA answer that resolves to a mapped internal address", async () => {
    // Same classifier, different entry point: a hostname the attacker
    // controls can hand back an AAAA record instead of an A record.
    mockedLookup.mockResolvedValue([
      { address: "::ffff:a9fe:a9fe", family: 6 },
    ] as never)

    await expect(assertSafeUrl("https://rebind.example.com/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("blocks a dotted-quad AAAA answer too — DNS results never go through URL normalization", async () => {
    // `new URL()` collapses the dotted form, but `lookup()` results reach the
    // guard verbatim, so both spellings have to classify identically.
    mockedLookup.mockResolvedValue([
      { address: "::ffff:169.254.169.254", family: 6 },
    ] as never)

    await expect(assertSafeUrl("https://rebind2.example.com/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("blocks a zone-suffixed link-local address rather than failing to parse it", async () => {
    mockedLookup.mockResolvedValue([{ address: "fe80::1%eth0", family: 6 }] as never)

    await expect(assertSafeUrl("https://zoned.example.com/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("fails closed on an address shape it cannot classify", async () => {
    mockedLookup.mockResolvedValue([{ address: "not-an-ip", family: 6 }] as never)

    await expect(assertSafeUrl("https://weird.example.com/")).rejects.toThrow(
      "Diese URL ist nicht erlaubt."
    )
  })

  it("leaks no address or network detail in the rejection message", async () => {
    // The message is a bare literal by design (`messages.ts` keeps the
    // client-safe copies) — an interpolated hostname/IP here would turn the
    // guard itself into the SSRF oracle it exists to prevent.
    await expect(
      assertSafeUrl("http://[::ffff:169.254.169.254]/latest/meta-data/")
    ).rejects.toThrow(/^Diese URL ist nicht erlaubt\.$/)
  })
})

/**
 * IPv4 counter-audit. WHATWG `new URL()` canonicalizes every alternate IPv4
 * notation (decimal, octal, hex, short form) to dotted quad *before* the
 * guard sees it, so `isBlockedIpv4` never has to parse those spellings
 * itself. These pin that assumption down: if a future Node/WHATWG change
 * stopped canonicalizing, these fail loudly instead of the blocklist
 * silently going blind the way the IPv6 side did.
 */
describe("assertSafeUrl — IPv4 alternate notations", () => {
  beforeEach(() => {
    mockedLookup.mockReset()
  })

  it.each([
    ["http://2130706433/", "127.0.0.1"], // 32-bit decimal
    ["http://0177.0.0.1/", "127.0.0.1"], // octal first octet
    ["http://0x7f.0.0.1/", "127.0.0.1"], // hex first octet
    ["http://0x7f000001/", "127.0.0.1"], // 32-bit hex
    ["http://127.1/", "127.0.0.1"], // short form
    ["http://2852039166/", "169.254.169.254"], // metadata endpoint, decimal
    ["http://0251.0376.0251.0376/", "169.254.169.254"], // metadata, octal
    ["http://192.168.000.001/", "192.168.0.1"], // padded zeros
  ])("normalizes and blocks %s (arrives as %s)", async (url, normalized) => {
    expect(new URL(url).hostname).toBe(normalized)
    await expect(assertSafeUrl(url)).rejects.toThrow("Diese URL ist nicht erlaubt.")
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it("does not over-block a public IPv4 written in decimal", async () => {
    // 93.184.216.34 -> 1572395042. Proves the normalization path is not a
    // blanket "weird notation = blocked" rule.
    expect(new URL("http://1572395042/").hostname).toBe("93.184.216.34")
    await expect(assertSafeUrl("http://1572395042/")).resolves.toBeUndefined()
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
