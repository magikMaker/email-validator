import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DNS_OVER_HTTPS_URL,
  DOMAIN_CHECK_DEFAULTS,
  checkEmailDomain,
  createDomainCheck,
  domainOfEmail,
  isNullMx,
  resolveDomainVerdict,
} from './index'
import type { DomainChecker, DomainVerdict, DomainVerdictCache } from './index'

/** One fake DNS answer: a status and records, a thrown error, or HTTP. */
type FakeDns =
  | { status: number; answer?: { type: number; data: string }[] }
  | { error: string }
  | { http: number }

/** The DNS questions the fake saw, as `name/type`. */
let asked: string[]

/** The fake answers by `name/type`; anything missing is NOERROR, empty. */
let answers: Record<string, FakeDns>

/** A fake DNS over HTTPS resolver in the shape of `fetch`. */
const fakeFetch = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    expect(`${url.origin}${url.pathname}`).toBe(DNS_OVER_HTTPS_URL)
    expect(new Headers(init?.headers).get('Accept')).toBe(
      'application/dns-json'
    )
    const key = `${url.searchParams.get('name')}/` +
      `${url.searchParams.get('type')}`
    asked.push(key)
    const fake = answers[key] ?? { status: 0 }
    if ('error' in fake) {
      throw new Error(fake.error)
    }
    if ('http' in fake) {
      return new Response('nope', { status: fake.http })
    }
    return new Response(
      JSON.stringify({ Status: fake.status, Answer: fake.answer }),
      { status: 200, headers: { 'Content-Type': 'application/dns-json' } }
    )
  }
) as unknown as typeof fetch

/**
 * A verdict cache backed by a map.
 * @returns The cache and its map
 */
function memoryCache(): DomainVerdictCache & {
  store: Map<string, DomainVerdict>
} {
  const store = new Map<string, DomainVerdict>()
  return {
    store,
    get: async (domain) => store.get(domain) ?? null,
    set: async (domain, verdict) => {
      store.set(domain, verdict)
    },
  }
}

/** An MX answer. */
const MX = { status: 0, answer: [{ type: 15, data: '10 mx.example.org.' }] }

describe('email domain check', () => {
  let cache: ReturnType<typeof memoryCache>
  let errors: string[]
  let check: DomainChecker

  beforeEach(() => {
    cache = memoryCache()
    errors = []
    asked = []
    answers = {}
    check = createDomainCheck({
      fetch: fakeFetch,
      cache,
      onError: (message) => errors.push(message),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reads the domain of an address and the null MX', () => {
    expect(domainOfEmail('Anna@Gmail.COM')).toBe('gmail.com')
    expect(domainOfEmail('no-at')).toBe('')
    expect(isNullMx('0 .')).toBe(true)
    expect(isNullMx('10 mx.example.org.')).toBe(false)
  })

  it('passes a domain with MX records', async () => {
    answers['gmail.com/MX'] = MX
    expect(await check('gmail.com')).toBe('ok')
    expect(asked).toEqual(['gmail.com/MX'])
  })

  it('refuses a domain that does not exist', async () => {
    answers['gmial.con/MX'] = { status: 3 }
    expect(await check('gmial.con')).toBe('undeliverable')
  })

  it('refuses the null MX and ignores other record types', async () => {
    answers['nomail.org/MX'] = {
      status: 0,
      answer: [
        { type: 5, data: 'alias.nomail.org.' },
        { type: 15, data: '0 .' },
      ],
    }
    expect(await check('nomail.org')).toBe('undeliverable')
  })

  it('falls back to A, then AAAA (implicit MX)', async () => {
    answers['a-only.org/A'] = {
      status: 0,
      answer: [{ type: 1, data: '192.0.2.1' }],
    }
    expect(await check('a-only.org')).toBe('ok')
    expect(asked).toEqual(['a-only.org/MX', 'a-only.org/A'])

    answers['v6.org/AAAA'] = {
      status: 0,
      answer: [{ type: 28, data: '2001:db8::1' }],
    }
    expect(await check('v6.org')).toBe('ok')

    expect(await check('empty.org')).toBe('undeliverable')
    expect(asked.slice(-3)).toEqual([
      'empty.org/MX',
      'empty.org/A',
      'empty.org/AAAA',
    ])
  })

  it('asks DNS for the punycode of an IDN domain', async () => {
    answers['xn--bcher-kva.de/MX'] = MX
    expect(await check('bücher.de')).toBe('ok')
    expect(asked).toEqual(['xn--bcher-kva.de/MX'])
  })

  it('refuses a name that is no domain without asking DNS', async () => {
    expect(await check('localhost')).toBe('undeliverable')
    expect(await check('a b.com')).toBe('undeliverable')
    expect(asked).toEqual([])
  })

  it('fails open on SERVFAIL, HTTP errors, odd bodies and fetch errors',
    async () => {
      answers['servfail.org/MX'] = { status: 2 }
      answers['http.org/MX'] = { http: 502 }
      answers['down.org/MX'] = { error: 'network down' }
      expect(await check('servfail.org')).toBe('ok')
      expect(await check('http.org')).toBe('ok')
      expect(await check('down.org')).toBe('ok')
      expect(errors).toHaveLength(3)
      expect(errors[0]).toContain('servfail.org')
      // A fail open verdict is never cached: the next call asks again.
      expect(cache.store.has('down.org')).toBe(false)
      await check('down.org')
      expect(asked.filter((a) => a === 'down.org/MX')).toHaveLength(2)

      const odd = createDomainCheck({
        fetch: (async () => new Response('{"Answer": 3}')) as typeof fetch,
      })
      expect(await odd('odd.org')).toBe('ok')
      const notJson = createDomainCheck({
        fetch: (async () => new Response('<html>')) as typeof fetch,
      })
      expect(await notJson('html.org')).toBe('ok')
    })

  it('fails open when DNS does not answer in time', async () => {
    vi.useFakeTimers()
    const hanging = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          )
        })
    ) as unknown as typeof fetch
    const slow = createDomainCheck({ fetch: hanging })
    const verdict = slow('slow.org')
    await vi.advanceTimersByTimeAsync(DOMAIN_CHECK_DEFAULTS.timeoutMs + 1)
    expect(await verdict).toBe('ok')
  })

  it('fails open when the caller aborts', async () => {
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted'))
        )
      })) as typeof fetch
    const controller = new AbortController()
    const pending = resolveDomainVerdict('slow.org', {
      fetch: hanging,
      signal: controller.signal,
    })
    controller.abort()
    expect(await pending).toBeNull()
    const already = new AbortController()
    already.abort()
    expect(
      await createDomainCheck({ fetch: hanging })('slow.org', {
        signal: already.signal,
      })
    ).toBe('ok')
  })

  it('caches verdicts in memory and in your cache with their TTLs',
    async () => {
      const set = vi.spyOn(cache, 'set')
      answers['gmail.com/MX'] = MX
      answers['gmial.con/MX'] = { status: 3 }
      await check('gmail.com')
      await check('gmial.con')
      await check('gmail.com')
      await check('gmial.con')
      expect(asked).toEqual(['gmail.com/MX', 'gmial.con/MX'])
      expect(set).toHaveBeenCalledWith(
        'gmail.com',
        'ok',
        DOMAIN_CHECK_DEFAULTS.okSeconds
      )
      expect(set).toHaveBeenCalledWith(
        'gmial.con',
        'undeliverable',
        DOMAIN_CHECK_DEFAULTS.undeliverableSeconds
      )
      // An empty memory reads your cache and asks DNS no more.
      check.clearMemory()
      expect(await check('gmial.con')).toBe('undeliverable')
      expect(asked).toHaveLength(2)
    })

  it('works without a cache and when the cache throws', async () => {
    answers['gmail.com/MX'] = MX
    const bare = createDomainCheck({ fetch: fakeFetch })
    expect(await bare('gmail.com')).toBe('ok')
    const broken: DomainVerdictCache = {
      get: async () => {
        throw new Error('kv down')
      },
      set: async () => {
        throw new Error('kv down')
      },
    }
    const reported: string[] = []
    const withBroken = createDomainCheck({
      fetch: fakeFetch,
      cache: broken,
      onError: (message) => reported.push(message),
    })
    expect(await withBroken('gmail.com')).toBe('ok')
    expect(reported).toHaveLength(2)
  })

  it('expires memory entries and keeps the map bounded', async () => {
    answers['gmail.com/MX'] = MX
    vi.useFakeTimers()
    const bare = createDomainCheck({ fetch: fakeFetch })
    await bare('gmail.com')
    vi.advanceTimersByTime(DOMAIN_CHECK_DEFAULTS.memorySeconds * 1000 + 1)
    await bare('gmail.com')
    expect(asked).toEqual(['gmail.com/MX', 'gmail.com/MX'])
    vi.useRealTimers()

    const small = createDomainCheck({
      fetch: fakeFetch,
      memory: { entries: 3 },
    })
    for (let i = 0; i <= 3; i++) {
      await small(`d${i}.org`)
    }
    asked = []
    // The first domain was dropped to make room; the last is still there.
    await small('d3.org')
    expect(asked).toEqual([])
    await small('d0.org')
    expect(asked[0]).toBe('d0.org/MX')
  })

  it('answers a primed verdict without DNS, and can skip memory',
    async () => {
      check.prime('bücher.de', 'undeliverable')
      expect(await check('xn--bcher-kva.de')).toBe('undeliverable')
      expect(asked).toEqual([])
      answers['gmail.com/MX'] = MX
      expect(await checkEmailDomain('gmail.com', { fetch: fakeFetch }))
        .toBe('ok')
      expect(await checkEmailDomain('gmail.com', { fetch: fakeFetch }))
        .toBe('ok')
      expect(asked).toEqual(['gmail.com/MX', 'gmail.com/MX'])
    })

  it('uses the global fetch and a custom endpoint', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      seen.push(String(input))
      return new Response(JSON.stringify(MX))
    })
    const google = createDomainCheck({
      endpoint: 'https://dns.google/resolve',
      memory: false,
    })
    expect(await google('gmail.com')).toBe('ok')
    expect(seen[0]).toBe(
      'https://dns.google/resolve?name=gmail.com&type=MX'
    )
  })
})
