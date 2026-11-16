/**
 * `@magikmaker/email-validator/dns`: whether a domain can receive mail,
 * asked over DNS over HTTPS (the JSON API Cloudflare and Google serve),
 * so it runs on Workers, Node and in the browser alike. A domain that
 * does not exist (NXDOMAIN), that publishes the null MX `0 .`
 * (RFC 7505), or that has neither an MX nor an address record (no
 * implicit MX, RFC 5321) is `undeliverable`.
 *
 * Anything that is not a clear answer (SERVFAIL, a timeout, a fetch
 * error, an odd body) counts as `ok`: the check fails open on purpose,
 * because a DNS outage must not stop signups. A fail open verdict is
 * never cached.
 *
 * Verdicts are cached in memory (bounded, short lived) and, when given,
 * in your own {@link DomainVerdictCache} (KV, D1, Redis): `ok` for 7
 * days, `undeliverable` for 6 hours, so a freshly configured domain soon
 * works.
 */

import { toAsciiDomain } from '../core/canonical.js'
import type {
  DomainCheck,
  DomainCheckCallOptions,
  DomainVerdict,
} from '../core/types.js'

export type {
  DomainCheck,
  DomainCheckCallOptions,
  DomainVerdict,
} from '../core/types.js'

/** Cloudflare's DNS over HTTPS endpoint (JSON API). */
export const DNS_OVER_HTTPS_URL = 'https://cloudflare-dns.com/dns-query'

/** The defaults of the domain check. */
export const DOMAIN_CHECK_DEFAULTS = {
  /** How long the DNS questions of one domain may take together. */
  timeoutMs: 2000,
  /** Domains the memory cache holds at most. */
  memoryEntries: 500,
  /** How long the memory cache keeps a verdict. */
  memorySeconds: 300,
  /** How long your cache keeps an `ok` verdict (7 days). */
  okSeconds: 7 * 24 * 60 * 60,
  /** How long your cache keeps an `undeliverable` verdict (6 hours). */
  undeliverableSeconds: 6 * 60 * 60,
} as const

/** A cache of domain verdicts you plug in (KV, D1, Redis, ...). */
export interface DomainVerdictCache {
  /**
   * The verdict stored for a domain, or null.
   * @param domain - The ASCII (punycode) domain
   * @returns The verdict or null
   */
  get(domain: string): Promise<DomainVerdict | null>
  /**
   * Store a verdict for a while.
   * @param domain - The ASCII (punycode) domain
   * @param verdict - The verdict
   * @param ttlSeconds - How long to keep it
   * @returns Resolves once stored
   */
  set(
    domain: string,
    verdict: DomainVerdict,
    ttlSeconds: number
  ): Promise<void>
}

/** How the domain check is set up; every field is optional. */
export interface DomainCheckOptions {
  /** The fetch to use; the global one when unset. */
  fetch?: typeof fetch
  /** The DNS JSON endpoint; {@link DNS_OVER_HTTPS_URL} when unset. */
  endpoint?: string
  /** The time the questions of one domain may take together. */
  timeoutMs?: number
  /** Your own cache, read after the memory cache. */
  cache?: DomainVerdictCache
  /**
   * The memory cache: entries and seconds, or false for none.
   * 500 entries for 300 seconds when unset.
   */
  memory?: false | { entries?: number; seconds?: number }
  /** How long your cache keeps an `ok` verdict, in seconds. */
  okSeconds?: number
  /** How long your cache keeps an `undeliverable` verdict, in seconds. */
  undeliverableSeconds?: number
  /**
   * Hears why a lookup failed open or a cache call failed. The message
   * names the domain, never an address.
   */
  onError?: (message: string) => void
}

/** DNS record type numbers in the JSON answers. */
const DNS_TYPE = { A: 1, MX: 15, AAAA: 28 } as const

/** DNS response codes the check acts on. */
const DNS_STATUS = { NOERROR: 0, NXDOMAIN: 3 } as const

/** One record of a DNS JSON answer. */
interface DnsAnswerRecord {
  /** The record type number. */
  type: number
  /** The record data, e.g. `10 mx.example.com.`. */
  data: string
}

/** The parts of a DNS JSON response the check reads. */
interface DnsJsonResponse {
  /** The response code. */
  Status: number
  /** The answer records. */
  Answer?: DnsAnswerRecord[]
}

/** How one DNS question ended. */
type DnsOutcome =
  | { kind: 'nxdomain' }
  | { kind: 'records'; records: DnsAnswerRecord[] }
  | { kind: 'failed'; why: string }

/**
 * The domain part of an address: the text after the last `@`, trimmed
 * and lowercased.
 * @param email - The address
 * @returns The domain, or an empty string when there is none
 */
export function domainOfEmail(email: string): string {
  const at = email.lastIndexOf('@')
  return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase()
}

/**
 * Whether an MX record is the null MX `0 .` (RFC 7505): the domain says
 * it accepts no mail.
 * @param data - The record data, e.g. `10 mx.example.com.`
 * @returns True for the null MX
 */
export function isNullMx(data: string): boolean {
  const [preference, exchange] = data.trim().split(/\s+/)
  return preference === '0' && (exchange === '.' || exchange === '')
}

/**
 * Whether a parsed body has the shape of a DNS JSON response.
 * @param body - The parsed body
 * @returns True when `Status` is a number and `Answer` a list of records
 */
function isDnsJson(body: unknown): body is DnsJsonResponse {
  if (typeof body !== 'object' || body === null) {
    return false
  }
  const value = body as { Status?: unknown; Answer?: unknown }
  if (typeof value.Status !== 'number') {
    return false
  }
  if (value.Answer === undefined) {
    return true
  }
  return (
    Array.isArray(value.Answer) &&
    value.Answer.every(
      (r: unknown) =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as DnsAnswerRecord).type === 'number' &&
        typeof (r as DnsAnswerRecord).data === 'string'
    )
  )
}

/**
 * Ask one DNS question over HTTPS.
 * @param fetchFn - The fetch
 * @param endpoint - The DNS JSON endpoint
 * @param name - The ASCII domain
 * @param type - `MX`, `A` or `AAAA`
 * @param signal - Aborts the fetch at the deadline
 * @returns How it ended
 */
async function askDns(
  fetchFn: typeof fetch,
  endpoint: string,
  name: string,
  type: keyof typeof DNS_TYPE,
  signal: AbortSignal
): Promise<DnsOutcome> {
  if (signal.aborted) {
    return { kind: 'failed', why: 'aborted' }
  }
  const url =
    `${endpoint}?name=${encodeURIComponent(name)}&type=${type}`
  let response: Response
  try {
    response = await fetchFn(url, {
      headers: { Accept: 'application/dns-json' },
      signal,
    })
  } catch (error) {
    return {
      kind: 'failed',
      why: error instanceof Error ? error.message : String(error),
    }
  }
  if (!response.ok) {
    return { kind: 'failed', why: `HTTP ${response.status}` }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'failed', why: 'not JSON' }
  }
  if (!isDnsJson(body)) {
    return { kind: 'failed', why: 'unexpected body' }
  }
  if (body.Status === DNS_STATUS.NXDOMAIN) {
    return { kind: 'nxdomain' }
  }
  if (body.Status !== DNS_STATUS.NOERROR) {
    return { kind: 'failed', why: `DNS status ${body.Status}` }
  }
  const wanted = DNS_TYPE[type]
  const records = (body.Answer ?? []).filter((r) => r.type === wanted)
  return { kind: 'records', records }
}

/** Options of {@link resolveDomainVerdict}. */
export interface ResolveOptions {
  /** The fetch to use; the global one when unset. */
  fetch?: typeof fetch
  /** The DNS JSON endpoint; {@link DNS_OVER_HTTPS_URL} when unset. */
  endpoint?: string
  /** The time the questions may take together. */
  timeoutMs?: number
  /** Aborts the lookup. */
  signal?: AbortSignal
  /** Hears why a lookup gave no clear answer. */
  onError?: (message: string) => void
}

/**
 * Resolve a domain's verdict from DNS, without any cache: MX first, then
 * A, then AAAA.
 * @param domain - The ASCII domain
 * @param options - See {@link ResolveOptions}
 * @returns The verdict, or null when DNS gave no clear answer
 */
export async function resolveDomainVerdict(
  domain: string,
  options: ResolveOptions = {}
): Promise<DomainVerdict | null> {
  const fetchFn =
    options.fetch ??
    ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      fetch(input, init))
  const endpoint = options.endpoint ?? DNS_OVER_HTTPS_URL
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DOMAIN_CHECK_DEFAULTS.timeoutMs
  )
  const onAbort = (): void => controller.abort()
  if (options.signal?.aborted) {
    controller.abort()
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (const type of ['MX', 'A', 'AAAA'] as const) {
      const outcome = await askDns(
        fetchFn,
        endpoint,
        domain,
        type,
        controller.signal
      )
      if (outcome.kind === 'failed') {
        options.onError?.(
          `The domain check failed open for ${domain} (${type}): ` +
            outcome.why
        )
        return null
      }
      if (outcome.kind === 'nxdomain') {
        return 'undeliverable'
      }
      if (outcome.records.length === 0) {
        continue
      }
      if (type === 'MX') {
        return outcome.records.every((r) => isNullMx(r.data))
          ? 'undeliverable'
          : 'ok'
      }
      return 'ok'
    }
    return 'undeliverable'
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/** A cached verdict in memory. */
interface MemoryEntry {
  /** The verdict. */
  verdict: DomainVerdict
  /** When it expires, epoch milliseconds. */
  until: number
}

/** A {@link DomainCheck} with its memory cache exposed for tests. */
export interface DomainChecker extends DomainCheck {
  /** Forget every verdict in the memory cache. */
  clearMemory(): void
  /**
   * Remember a verdict ahead of any DNS question, to save a lookup or to
   * keep DNS out of a test.
   * @param domain - The domain as typed (IDN allowed)
   * @param verdict - The verdict
   */
  prime(domain: string, verdict: DomainVerdict): void
}

/**
 * Make a domain check: memory cache, then your cache, then DNS. It never
 * throws: a DNS failure answers `ok` (fail open), is reported through
 * `onError` and is never cached. A name that is not a domain with a dot
 * is `undeliverable` without a lookup.
 * @param options - See {@link DomainCheckOptions}
 * @returns The check, ready for the core's `dns` option
 */
export function createDomainCheck(
  options: DomainCheckOptions = {}
): DomainChecker {
  const memoryEntries =
    options.memory === false
      ? 0
      : options.memory?.entries ?? DOMAIN_CHECK_DEFAULTS.memoryEntries
  const memorySeconds =
    options.memory === false
      ? 0
      : options.memory?.seconds ?? DOMAIN_CHECK_DEFAULTS.memorySeconds
  const okSeconds = options.okSeconds ?? DOMAIN_CHECK_DEFAULTS.okSeconds
  const undeliverableSeconds =
    options.undeliverableSeconds ??
    DOMAIN_CHECK_DEFAULTS.undeliverableSeconds
  const memory = new Map<string, MemoryEntry>()
  const report = (message: string): void => {
    try {
      options.onError?.(message)
    } catch {
      // A failing reporter must not break the check.
    }
  }

  /**
   * A verdict from memory, or null when absent or expired.
   * @param domain - The ASCII domain
   * @returns The verdict or null
   */
  function fromMemory(domain: string): DomainVerdict | null {
    const entry = memory.get(domain)
    if (!entry) {
      return null
    }
    if (entry.until <= Date.now()) {
      memory.delete(domain)
      return null
    }
    return entry.verdict
  }

  /**
   * Keep a verdict in memory, dropping the oldest entry when full.
   * @param domain - The ASCII domain
   * @param verdict - The verdict
   */
  function remember(domain: string, verdict: DomainVerdict): void {
    if (memoryEntries <= 0) {
      return
    }
    memory.delete(domain)
    while (memory.size >= memoryEntries) {
      const oldest = memory.keys().next()
      if (oldest.done) {
        break
      }
      memory.delete(oldest.value)
    }
    memory.set(domain, {
      verdict,
      until: Date.now() + memorySeconds * 1000,
    })
  }

  /**
   * A verdict from your cache, or null when absent or unreadable.
   * @param domain - The ASCII domain
   * @returns The verdict or null
   */
  async function fromCache(domain: string): Promise<DomainVerdict | null> {
    if (!options.cache) {
      return null
    }
    try {
      const value = await options.cache.get(domain)
      return value === 'ok' || value === 'undeliverable' ? value : null
    } catch (error) {
      report(
        'The domain cache read failed: ' +
          (error instanceof Error ? error.message : String(error))
      )
      return null
    }
  }

  /**
   * Store a verdict in your cache. A failure is reported only.
   * @param domain - The ASCII domain
   * @param verdict - The verdict
   */
  async function store(domain: string, verdict: DomainVerdict): Promise<void> {
    if (!options.cache) {
      return
    }
    try {
      await options.cache.set(
        domain,
        verdict,
        verdict === 'ok' ? okSeconds : undeliverableSeconds
      )
    } catch (error) {
      report(
        'The domain cache write failed: ' +
          (error instanceof Error ? error.message : String(error))
      )
    }
  }

  const check = async (
    domain: string,
    call: DomainCheckCallOptions = {}
  ): Promise<DomainVerdict> => {
    const ascii = toAsciiDomain(domain)
    if (!ascii || !ascii.includes('.')) {
      return 'undeliverable'
    }
    const remembered = fromMemory(ascii)
    if (remembered) {
      return remembered
    }
    const stored = await fromCache(ascii)
    if (stored) {
      remember(ascii, stored)
      return stored
    }
    const verdict = await resolveDomainVerdict(ascii, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(call.signal ? { signal: call.signal } : {}),
      onError: report,
    })
    if (verdict === null) {
      return 'ok'
    }
    remember(ascii, verdict)
    await store(ascii, verdict)
    return verdict
  }

  return Object.assign(check, {
    clearMemory(): void {
      memory.clear()
    },
    prime(domain: string, verdict: DomainVerdict): void {
      const ascii = toAsciiDomain(domain)
      if (ascii) {
        remember(ascii, verdict)
      }
    },
  })
}

/**
 * Check one domain without a memory cache: your cache (when given), then
 * DNS. For a long running process prefer one {@link createDomainCheck}.
 * @param domain - The domain as typed (IDN allowed)
 * @param options - See {@link DomainCheckOptions}
 * @returns `ok`, or `undeliverable` when the domain cannot receive mail
 */
export function checkEmailDomain(
  domain: string,
  options: DomainCheckOptions = {}
): Promise<DomainVerdict> {
  return createDomainCheck({ ...options, memory: false })(domain)
}
