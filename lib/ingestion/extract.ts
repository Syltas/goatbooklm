import { lookup } from "node:dns/promises"
import { isIP, isIPv4, isIPv6 } from "node:net"
import type { LookupFunction } from "node:net"

import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import { Agent, fetch as undiciFetch } from "undici"
import { extractText, getDocumentProxy } from "unpdf"

export interface PageOffset {
  page: number
  charStart: number
  charEnd: number
}

/**
 * Extracts text from a PDF's raw bytes via `unpdf` (serverless-friendly
 * pdf.js re-package, no native bindings/filesystem access — specs/02
 * §9 "Empfehlung: unpdf"). Pages are joined with `\n\n`; `pageOffsets`
 * records the exact char range each page occupies in the joined `text`, so
 * `chunks.metadata.page` (§8 fixed contract) can be derived from a chunk's
 * `charStart`.
 */
export async function extractPdfText(
  bytes: Uint8Array
): Promise<{ text: string; pageOffsets: PageOffset[] }> {
  const pdf = await getDocumentProxy(bytes)
  const { text: pages } = await extractText(pdf, { mergePages: false })

  let text = ""
  const pageOffsets: PageOffset[] = []

  pages.forEach((pageText, i) => {
    const charStart = text.length
    text += pageText
    pageOffsets.push({ page: i + 1, charStart, charEnd: text.length })
    if (i < pages.length - 1) text += "\n\n"
  })

  return { text, pageOffsets }
}

// Robustness fix: these three used to be a single `SSRF_MESSAGE` thrown for
// every rejection reason alike (bad scheme, blocked address, AND a
// transient DNS/network failure) — indistinguishable to the user, and a DNS
// hiccup looked exactly like a deliberate security block with no hint that
// retrying might just work. Byte-identical duplicates of
// `messages.ts`'s `ssrfSchemeUnsupported`/`ssrfBlocked`/`ssrfDnsFailed` (not
// imported — see that module's docstring on why client-safe messages live
// zero-dependency there while this file pulls in `undici`/DNS); keep them in
// sync, since `actions.ts`'s `KNOWN_INGESTION_MESSAGES` passthrough only
// recognizes an error by exact string match.
const SSRF_SCHEME_MESSAGE = "URL-Schema nicht unterstützt — nur http/https erlaubt."
const SSRF_BLOCKED_MESSAGE = "Diese URL ist nicht erlaubt."
const SSRF_DNS_MESSAGE = "Adresse konnte nicht aufgelöst werden — bitte später erneut versuchen."

export interface SafeUrlResolution {
  /** Bare hostname (brackets stripped for an IPv6 literal). */
  hostname: string
  /** Every already-validated-safe resolved IP address for `hostname`, in
   *  resolution order — a single-element array when `hostname` is itself an
   *  IP literal. Used by `fetchWebPage` to pin the actual TCP/TLS connection
   *  to `ips[0]` (see its doc comment) rather than trusting a second,
   *  unguarded DNS resolution inside `fetch()`. */
  ips: string[]
}

/**
 * Resolves DNS for `url`'s hostname (if it isn't already an IP literal) and
 * validates every check the SSRF guard cares about (spec §9 OV5 + task
 * brief): non-http(s) schemes, `localhost`, private/loopback/link-local
 * IPv4 and IPv6 ranges, and explicitly the cloud metadata endpoint
 * `169.254.169.254`. Rejects (fails closed) if ANY resolved address is
 * unsafe, even if that address wouldn't end up being the one connected to —
 * a mixed-safe/unsafe answer set is itself suspicious. The rejection message
 * differs by cause (`SSRF_SCHEME_MESSAGE`/`SSRF_BLOCKED_MESSAGE`/
 * `SSRF_DNS_MESSAGE` below) so a transient DNS failure doesn't read as an
 * indistinguishable security block to the user — the fail-closed *behavior*
 * (nothing gets fetched) is identical across all three, only the string
 * differs.
 *
 * Shared implementation behind both `assertSafeUrl` (pre-checks that don't
 * need the resolved IP, e.g. the create-time check before any row exists)
 * and `resolveAndAssertSafe` (checks that DO need it, to pin a connection —
 * see `fetchWebPage`).
 */
async function checkUrlSafety(url: string): Promise<SafeUrlResolution> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(SSRF_SCHEME_MESSAGE)
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(SSRF_SCHEME_MESSAGE)
  }

  // `URL#hostname` keeps the `[...]` brackets for IPv6 literals (e.g.
  // `http://[::1]/` -> hostname `"[::1]"`) — strip them before any IP check,
  // `net.isIP`/DNS APIs expect the bare address.
  const rawHostname = parsed.hostname.toLowerCase()
  const hostname =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(SSRF_BLOCKED_MESSAGE)
  }

  // Hostname is already a literal IP — no DNS involved, check directly.
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error(SSRF_BLOCKED_MESSAGE)
    return { hostname, ips: [hostname] }
  }

  let records: { address: string }[]
  try {
    records = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    // Unresolvable hostname — fail closed rather than let a downstream
    // fetch() attempt its own (unguarded) resolution. Distinct message from
    // the blocked-address cases below: this is a transient DNS/network
    // condition (worth retrying), not a deliberate security decision — but
    // the *behavior* is identical either way (nothing gets fetched). No
    // internal detail (the hostname, the DNS error) is included in the
    // message itself.
    throw new Error(SSRF_DNS_MESSAGE)
  }

  if (records.length === 0) throw new Error(SSRF_DNS_MESSAGE)
  for (const record of records) {
    if (isBlockedIp(record.address)) throw new Error(SSRF_BLOCKED_MESSAGE)
  }

  return { hostname, ips: records.map((record) => record.address) }
}

/**
 * Synchronous-looking name kept from the spec's original pseudocode (§9),
 * but the *implementation* is necessarily async: real SSRF protection
 * requires resolving DNS for the hostname and checking every returned
 * address, which cannot be done without I/O. Callers must `await` it.
 *
 * Void-returning pre-check for call sites that don't need the resolved IP
 * (e.g. `createWebSource`'s fail-fast check before any row exists — the
 * actual fetch, and any IP pinning, happens later at process time). See
 * `resolveAndAssertSafe` for the variant that also hands back the IP(s).
 */
export async function assertSafeUrl(url: string): Promise<void> {
  await checkUrlSafety(url)
}

/**
 * Same checks as `assertSafeUrl`, but also returns the validated hostname +
 * IP address(es) so the caller can pin its actual network connection to an
 * address that has ALREADY been checked safe (Eng-Review H1) — closing the
 * TOCTOU/DNS-rebinding window between "hostname resolved to a safe IP" and
 * "connection actually opens" that a plain re-check-then-fetch can't close
 * (an attacker-controlled DNS server could rebind the name to a private IP
 * in between the two). See `fetchWebPage`, which calls this once per
 * redirect hop and pins that hop's connection to `ips[0]`.
 */
export async function resolveAndAssertSafe(url: string): Promise<SafeUrlResolution> {
  return checkUrlSafety(url)
}

function isBlockedIp(ip: string): boolean {
  if (isIPv4(ip)) return isBlockedIpv4(ip)
  if (isIPv6(ip)) return isBlockedIpv6(ip)
  // Unknown/unparseable address shape — fail closed.
  return true
}

const IPV4_BLOCKED_RANGES: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes the 169.254.169.254 cloud metadata endpoint
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
]

function ipv4ToInt(ip: string): number {
  return (
    ip
      .split(".")
      .reduce((acc, part) => (acc << 8) + (Number(part) & 0xff), 0) >>> 0
  )
}

function isBlockedIpv4(ip: string): boolean {
  const target = ipv4ToInt(ip)
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (target & mask) === (ipv4ToInt(base) & mask)
  })
}

/**
 * Expands an IPv6 literal to its 16 raw bytes, or `null` if it isn't one.
 *
 * WHY BYTES, NOT TEXT — do not replace this with prefix/regex matching on the
 * address string. One IPv6 address has many equally valid spellings, and the
 * caller never gets to choose which one arrives: WHATWG `new URL()`
 * canonicalizes the host *before* this module sees it, collapsing any
 * embedded dotted quad into hex hextets. `http://[::ffff:127.0.0.1]/` reaches
 * us as `::ffff:7f00:1`, `http://[::ffff:169.254.169.254]/` as
 * `::ffff:a9fe:a9fe`, and `0:0:0:0:0:ffff:7f00:1` collapses to the same thing
 * again. A regex written against the dotted spelling matches none of them and
 * is simply dead code on the URL path — which is exactly how a
 * `/^::ffff:(\d+\.\d+\.\d+\.\d+)$/` branch here once let the cloud metadata
 * endpoint through. Bytes are the one representation every spelling agrees
 * on.
 *
 * Validation is delegated to `net.isIPv6` first, so this only has to expand a
 * shape already known to be well-formed; anything it still can't expand
 * returns `null` and the caller fails closed.
 */
function ipv6ToBytes(ip: string): Uint8Array | null {
  // A zone id (`fe80::1%eth0`) is accepted by `net.isIPv6` but says nothing
  // about *which* address this is — strip it so the address still classifies
  // (a zone-suffixed link-local is precisely the shape an attacker would try).
  const address = ip.toLowerCase().split("%")[0]
  if (!isIPv6(address)) return null

  const gapAt = address.indexOf("::")
  const head = gapAt === -1 ? address : address.slice(0, gapAt)
  const tail = gapAt === -1 ? "" : address.slice(gapAt + 2)

  const hextetsOf = (segment: string): number[] | null => {
    if (segment === "") return []
    const groups = segment.split(":")
    const out: number[] = []

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]

      // A trailing dotted quad (`::ffff:a.b.c.d`) occupies the final two
      // hextets. Still handled even though `new URL()` never produces it,
      // because DNS answers and `assertSafeUrl` callers can pass a raw
      // literal that never went through URL parsing.
      if (i === groups.length - 1 && group.includes(".")) {
        const octets = group.split(".")
        if (octets.length !== 4) return null
        const values: number[] = []
        for (const octet of octets) {
          if (!/^\d{1,3}$/.test(octet)) return null
          const value = Number(octet)
          if (value > 255) return null
          values.push(value)
        }
        out.push((values[0] << 8) | values[1], (values[2] << 8) | values[3])
        continue
      }

      if (!/^[0-9a-f]{1,4}$/.test(group)) return null
      out.push(parseInt(group, 16))
    }

    return out
  }

  const headHextets = hextetsOf(head)
  const tailHextets = hextetsOf(tail)
  if (!headHextets || !tailHextets) return null

  const gap = 8 - headHextets.length - tailHextets.length
  if (gap < 0 || (gapAt === -1 && gap !== 0)) return null

  const hextets = [
    ...headHextets,
    ...new Array<number>(gap).fill(0),
    ...tailHextets,
  ]
  if (hextets.length !== 8) return null

  const bytes = new Uint8Array(16)
  hextets.forEach((hextet, i) => {
    bytes[i * 2] = hextet >> 8
    bytes[i * 2 + 1] = hextet & 0xff
  })
  return bytes
}

/** Parses a range literal at module load. A throw here is a typo in the
 *  tables below, i.e. a programming error that must surface immediately
 *  rather than silently degrade one range into "not blocked". */
function prefixBytes(literal: string): Uint8Array {
  const bytes = ipv6ToBytes(literal)
  if (!bytes) throw new Error(`invalid IPv6 range literal: ${literal}`)
  return bytes
}

function hasIpv6Prefix(bytes: Uint8Array, prefix: Uint8Array, bits: number): boolean {
  const wholeBytes = bits >> 3
  for (let i = 0; i < wholeBytes; i++) {
    if (bytes[i] !== prefix[i]) return false
  }
  const remainingBits = bits & 7
  if (remainingBits === 0) return true
  const mask = (0xff << (8 - remainingBits)) & 0xff
  return (bytes[wholeBytes] & mask) === (prefix[wholeBytes] & mask)
}

/** Ranges blocked outright, independent of anything they may embed. */
const IPV6_BLOCKED_RANGES: [Uint8Array, number][] = [
  [prefixBytes("::"), 128], // unspecified
  [prefixBytes("::1"), 128], // loopback
  // IPv4-compatible ::a.b.c.d — deprecated by RFC 4291 §2.5.5.1 and never a
  // legitimate destination, so the whole /96 goes rather than only the
  // embedded IPv4 (which would leave e.g. `::8.8.8.8` reachable through a
  // deprecated, translator-ambiguous encoding). Note ::/96 does NOT overlap
  // the IPv4-mapped range below: that one carries 0xffff in bytes 10-11.
  [prefixBytes("::"), 96],
  [prefixBytes("fc00::"), 7], // unique local
  [prefixBytes("fe80::"), 10], // link local
  [prefixBytes("fec0::"), 10], // site local (deprecated, RFC 3879)
  [prefixBytes("ff00::"), 8], // multicast
  [prefixBytes("100::"), 64], // discard-only (RFC 6666)
  [prefixBytes("2001::"), 32], // Teredo — tunnels an operator-chosen IPv4 endpoint
  [prefixBytes("2001:db8::"), 32], // documentation (RFC 3849)
  // NAT64 local-use (RFC 8215). Blocked wholesale rather than unwrapped: the
  // prefix may be any of RFC 6052's lengths, so the embedded IPv4 has no
  // fixed byte offset to check. Nothing legitimate is served from here.
  [prefixBytes("64:ff9b:1::"), 48],
]

/** Ranges that carry an IPv4 address inside them — the embedded octets must
 *  clear the SAME `isBlockedIpv4` list a native IPv4 host would, otherwise
 *  every entry in `IPV4_BLOCKED_RANGES` has a second, unguarded spelling. */
const IPV6_EMBEDDED_IPV4_RANGES: {
  prefix: Uint8Array
  bits: number
  /** Byte offset of the embedded IPv4 address within the 16 bytes. */
  offset: number
}[] = [
  // IPv4-mapped ::ffff:a.b.c.d — the metadata-endpoint bypass this whole
  // rewrite exists for (`::ffff:a9fe:a9fe` -> 169.254.169.254).
  { prefix: prefixBytes("::ffff:0:0"), bits: 96, offset: 12 },
  // IPv4-translated ::ffff:0:a.b.c.d (SIIT, RFC 2765).
  { prefix: prefixBytes("::ffff:0:0:0"), bits: 96, offset: 12 },
  // NAT64 well-known prefix (RFC 6052) — fixed /96, so the IPv4 is bytes 12-15.
  { prefix: prefixBytes("64:ff9b::"), bits: 96, offset: 12 },
  // 6to4 (RFC 3056): 2002:<IPv4>::/48 — the IPv4 sits in bytes 2-5.
  { prefix: prefixBytes("2002::"), bits: 16, offset: 2 },
]

function ipv4At(bytes: Uint8Array, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`
}

function isBlockedIpv6(ip: string): boolean {
  const bytes = ipv6ToBytes(ip)
  // Well-formed enough for `net.isIP` but not expandable here — fail closed
  // rather than treat an address we couldn't classify as safe.
  if (!bytes) return true

  if (IPV6_BLOCKED_RANGES.some(([prefix, bits]) => hasIpv6Prefix(bytes, prefix, bits))) {
    return true
  }

  return IPV6_EMBEDDED_IPV4_RANGES.some(
    ({ prefix, bits, offset }) =>
      hasIpv6Prefix(bytes, prefix, bits) && isBlockedIpv4(ipv4At(bytes, offset))
  )
}

export interface FetchWebPageOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}

export interface FetchWebPageResult {
  html: string
  finalUrl: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 10_485_760
const DEFAULT_MAX_REDIRECTS = 5

/**
 * Builds a `net`/`tls` `lookup` override (Eng-Review H1) that always
 * resolves to the single, already-validated-safe `ip` regardless of what
 * hostname it's asked to resolve — used to pin one hop's connection to the
 * exact address `resolveAndAssertSafe` just checked, closing the
 * TOCTOU/DNS-rebinding window a plain "re-check DNS, then call fetch()
 * separately" approach leaves open (an attacker-controlled DNS server could
 * rebind the name to a private IP in the gap between the two). Only the
 * *address resolution* is overridden — TLS SNI and the HTTP `Host` header
 * both still come from `currentUrl`'s real hostname (via `undici`'s default
 * connector's own `servername`/`Host` derivation, and from `fetch()` being
 * called with `currentUrl` itself, not a rewritten IP-based URL) — so this
 * is connection-target pinning, not hostname spoofing.
 */
function createPinnedLookup(ip: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options !== "function" && options.all) {
      callback(null, [{ address: ip, family }])
    } else {
      // Cast: the single-address callback overload isn't distinguished from
      // the `all`-array overload at the type level for this hand-written
      // function (see `node:net`'s single, non-overloaded `LookupFunction`
      // alias) — both branches are valid `dns.lookup`-compatible shapes.
      ;(callback as (err: null, address: string, family: number) => void)(
        null,
        ip,
        family
      )
    }
  }
}

function createPinnedDispatcher(ip: string): Agent {
  const family = isIPv6(ip) ? 6 : 4
  return new Agent({
    connect: { lookup: createPinnedLookup(ip, family) },
  })
}

/**
 * Fetches a web page as a manual redirect loop, SSRF-checking every hop
 * before connecting AND pinning that hop's actual TCP/TLS connection to the
 * checked-safe IP (spec §9 OV5, Eng-Review H1). `fetch(url, { redirect:
 * 'follow' })` cannot be used here: it would resolve DNS and connect to
 * redirect targets transparently, with no chance to reject an internal IP
 * in between.
 *
 * Uses `undici`'s own `fetch` (not the Node-global one) together with an
 * `undici`-native `Agent`/`connect.lookup` override — Node's built-in
 * global `fetch` runs on its own internal, separately-bundled copy of
 * undici, and passing a `dispatcher` constructed from the external `undici`
 * package to it throws (`InvalidArgumentError: invalid onRequestStart
 * method`, confirmed empirically); `fetch`+`Agent` must come from the same
 * `undici` instance for a custom dispatcher to work at all.
 *
 * TOCTOU / DNS-rebinding: `resolveAndAssertSafe` resolves DNS and validates
 * every returned address for the CURRENT hop, then `createPinnedDispatcher`
 * forces the actual socket connect to use `ips[0]` directly via a custom
 * `lookup`, instead of letting `undici`'s connector re-resolve DNS itself
 * (which is what would reopen the gap). Each redirect hop repeats this pair
 * from scratch against its own target — a hop can never reuse a previous
 * hop's resolution/pin.
 */
export async function fetchWebPage(
  url: string,
  opts: FetchWebPageOptions = {}
): Promise<FetchWebPageResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  let currentUrl = url

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { ips } = await resolveAndAssertSafe(currentUrl)
    const dispatcher = createPinnedDispatcher(ips[0])

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      let response: Awaited<ReturnType<typeof undiciFetch>>
      try {
        response = await undiciFetch(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": "GoatbookLM-Ingestion/1.0" },
          dispatcher,
        })
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Zeitüberschreitung beim Laden der Seite.")
        }
        throw new Error("Seite nicht erreichbar.")
      } finally {
        clearTimeout(timeout)
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        if (!location) {
          throw new Error("Seite nicht erreichbar (ungültige Weiterleitung).")
        }
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }

      if (!response.ok) {
        throw new Error(`Seite nicht erreichbar (${response.status}).`)
      }

      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new Error("Kein lesbarer Inhalt auf dieser Seite gefunden.")
      }

      const html = await readBodyWithCap(response, maxBytes)
      return { html, finalUrl: currentUrl }
    } finally {
      // Closed after every outcome for this hop (success, redirect,
      // continue, or a thrown error) — each hop gets its own short-lived,
      // single-IP-pinned dispatcher, never reused across hops.
      await dispatcher.close()
    }
  }

  throw new Error("Zu viele Weiterleitungen.")
}

async function readBodyWithCap(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  maxBytes: number
): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) {
      throw new Error("Seite ist zu groß.")
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error("Seite ist zu groß.")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf-8"
  )
}

/**
 * Extracts the main article text from an HTML document via
 * `@mozilla/readability` (Firefox Reader View's engine) over a `linkedom`
 * DOM (lighter/no native deps vs. `jsdom`, sufficient DOM subset for
 * Readability — spec §9 "Empfehlung"). Pure — takes already-fetched HTML,
 * does no network I/O itself.
 */
export function extractWebText(
  html: string,
  url: string
): { text: string; title?: string } {
  void url // kept for interface symmetry / future base-URL resolution use

  const { document } = parseHTML(html)
  const reader = new Readability(document as unknown as Document)
  const article = reader.parse()

  const text = (article?.textContent ?? "").trim()
  if (text.length < 50) {
    throw new Error("Kein lesbarer Inhalt auf dieser Seite gefunden.")
  }

  const title = article?.title?.trim()
  return title ? { text, title } : { text }
}
