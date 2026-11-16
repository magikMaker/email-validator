import { afterEach, describe, expect, it, vi } from 'vitest'
import { gatePolicy, reviewPolicy } from '../../core/policy'
import { VerifierError } from '../../core/verifier'
import {
  KICKBOX_REQUEST_TIMEOUT_MARGIN_MS,
  KICKBOX_TIMEOUT_MS,
  backoffMs,
  kickbox,
  kickboxRawRecord,
  kickboxStatusOf,
} from './index'
import type { KickboxResponse } from './index'
import {
  ACCEPT_ALL,
  BAD_KEY,
  DELIVERABLE,
  DISPOSABLE,
  ROLE,
  UNDELIVERABLE,
  UNKNOWN,
} from './kickbox.fixtures'

/**
 * A fetch that answers the given responses in turn and records URLs.
 * @param answers - The responses
 * @returns The fetch and the URLs it saw
 */
function fetchOf(answers: Response[]): {
  fetchFn: typeof fetch
  urls: string[]
} {
  const urls: string[] = []
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input))
    const next = answers.shift()
    if (!next) {
      throw new Error('no more answers')
    }
    return next
  }) as unknown as typeof fetch
  return { fetchFn, urls }
}

const noSleep = async (): Promise<void> => undefined

describe('kickbox status mapping', () => {
  it('maps every recorded answer onto a status and both policies', () => {
    const cases: Array<[KickboxResponse, string, string, string]> = [
      [DELIVERABLE, 'valid', 'send', 'send'],
      [UNDELIVERABLE, 'invalid', 'reject', 'reject'],
      [ACCEPT_ALL, 'catch_all', 'review', 'send'],
      [DISPOSABLE, 'disposable', 'reject', 'reject'],
      [ROLE, 'role', 'review', 'send'],
      [UNKNOWN, 'unknown', 'review', 'send'],
    ]
    for (const [answer, status, review, gate] of cases) {
      const mapped = kickboxStatusOf(answer)
      expect(mapped).toBe(status)
      expect(reviewPolicy(mapped)).toBe(review)
      expect(gatePolicy(mapped)).toBe(gate)
    }
  })

  it('stores no address fields', () => {
    const raw = kickboxRawRecord(UNDELIVERABLE)
    const text = JSON.stringify(raw)
    expect(text).not.toContain('bill.lumbergh')
    expect(raw).toMatchObject({
      provider: 'kickbox',
      result: 'undeliverable',
      reason: 'rejected_email',
      domain: 'gamil.com',
      didYouMeanDomain: 'gmail.com',
      sendex: 0.23,
    })
    expect(kickboxRawRecord({ email: 'a@B.nl ' }).domain).toBe('b.nl')
    expect(kickboxRawRecord({ did_you_mean: 'nope' }).didYouMeanDomain)
      .toBeNull()
  })

  it('backs off by Retry-After or doubling, at most 5 seconds', () => {
    expect(backoffMs(1, null)).toBe(500)
    expect(backoffMs(2, null)).toBe(1000)
    expect(backoffMs(1, '2')).toBe(2000)
    expect(backoffMs(1, '60')).toBe(5000)
  })
})

describe('kickbox provider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('calls the single verification API and maps the answer', async () => {
    const { fetchFn, urls } = fetchOf([Response.json(ACCEPT_ALL)])
    const provider = kickbox({ apiKey: 'k', fetch: fetchFn })
    expect(provider.name).toBe('kickbox')
    const result = await provider.verify('piet@acme.nl')
    expect(result.status).toBe('catch_all')
    const url = new URL(urls[0] ?? '')
    expect(url.origin + url.pathname).toBe(
      'https://api.kickbox.com/v2/verify'
    )
    expect(url.searchParams.get('email')).toBe('piet@acme.nl')
    expect(url.searchParams.get('apikey')).toBe('k')
    expect(url.searchParams.get('timeout')).toBe(String(KICKBOX_TIMEOUT_MS))
    expect(JSON.stringify(result.raw)).not.toContain('piet@')
  })

  it('uses the global fetch and a custom API base', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return Response.json(DELIVERABLE)
    })
    const provider = kickbox({
      apiKey: 'k',
      apiBase: 'https://proxy.example.org/kickbox/',
    })
    expect((await provider.verify('a@acme.nl')).status).toBe('valid')
    expect(urls[0]).toMatch(/^https:\/\/proxy\.example\.org\/kickbox\/verify/)
  })

  it('retries a 429 and a 5xx when attempts are left', async () => {
    const sleep = vi.fn(async () => undefined)
    const { fetchFn, urls } = fetchOf([
      new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }),
      new Response('oops', { status: 503 }),
      Response.json(DELIVERABLE),
    ])
    const provider = kickbox({
      apiKey: 'k',
      fetch: fetchFn,
      sleep,
      maxAttempts: 3,
      timeoutMs: 6000,
    })
    const result = await provider.verify('anna.jansen@gmail.com')
    expect(result.status).toBe('valid')
    expect(urls).toHaveLength(3)
    expect(new URL(urls[0] ?? '').searchParams.get('timeout')).toBe('6000')
    expect(sleep).toHaveBeenNthCalledWith(1, 1000)
    expect(sleep).toHaveBeenNthCalledWith(2, 1000)
  })

  it('makes one attempt by default and fails with a VerifierError',
    async () => {
      const sleep = vi.fn(async () => undefined)
      const { fetchFn, urls } = fetchOf([
        new Response('down', { status: 503 }),
        Response.json(DELIVERABLE),
      ])
      const provider = kickbox({ apiKey: 'k', fetch: fetchFn, sleep })
      const error = await provider.verify('a@acme.nl').catch(
        (e: unknown) => e
      )
      expect(error).toBeInstanceOf(VerifierError)
      expect((error as VerifierError).retryable).toBe(true)
      expect(urls).toHaveLength(1)
      expect(sleep).not.toHaveBeenCalled()
    })

  it('gives up after the last attempt', async () => {
    const answers = Array.from({ length: 3 }, () =>
      new Response('down', { status: 502 }))
    const { fetchFn, urls } = fetchOf(answers)
    const provider = kickbox({ apiKey: 'k', fetch: fetchFn,
      sleep: noSleep, maxAttempts: 3 })
    await expect(provider.verify('a@acme.nl')).rejects.toBeInstanceOf(
      VerifierError
    )
    expect(urls).toHaveLength(3)
  })

  it('does not retry a refused request and never names the address',
    async () => {
      const { fetchFn, urls } = fetchOf([
        Response.json(BAD_KEY, { status: 403 }),
      ])
      const provider = kickbox({ apiKey: 'secret-key', fetch: fetchFn,
        sleep: noSleep, maxAttempts: 3 })
      const error = await provider.verify('secret@acme.nl').catch(
        (e: unknown) => e
      )
      expect(error).toBeInstanceOf(VerifierError)
      expect((error as Error).message).toContain('Invalid API Key')
      expect((error as Error).message).not.toContain('secret@acme.nl')
      expect((error as Error).message).not.toContain('secret-key')
      expect(urls).toHaveLength(1)
    })

  it('refuses an answer without JSON or with success false', async () => {
    const { fetchFn } = fetchOf([
      new Response('<html>', { status: 200 }),
      Response.json({ success: false }),
    ])
    const provider = kickbox({ apiKey: 'k', fetch: fetchFn })
    await expect(provider.verify('a@acme.nl')).rejects.toThrow('no JSON')
    await expect(provider.verify('a@acme.nl')).rejects.toThrow(
      'Kickbox refused the request (200)'
    )
  })

  it('aborts its request on its own timeout', async () => {
    vi.useFakeTimers()
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted'))
        )
      })) as typeof fetch
    const provider = kickbox({ apiKey: 'k', fetch: hanging,
      timeoutMs: 1000 })
    const pending = provider.verify('a@acme.nl').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(
      1000 + KICKBOX_REQUEST_TIMEOUT_MARGIN_MS + 1
    )
    const error = await pending
    expect(error).toBeInstanceOf(VerifierError)
    expect((error as VerifierError).timedOut).toBe(true)
  })

  it('honours the caller signal, before and during a request',
    async () => {
      const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          )
        })) as typeof fetch
      const provider = kickbox({ apiKey: 'k', fetch: hanging,
        maxAttempts: 3, sleep: noSleep })
      const already = new AbortController()
      already.abort()
      await expect(
        provider.verify('a@acme.nl', { signal: already.signal })
      ).rejects.toThrow('aborted')
      const controller = new AbortController()
      const pending = provider
        .verify('a@acme.nl', { signal: controller.signal })
        .catch((e: unknown) => e)
      controller.abort()
      const error = await pending
      expect(error).toBeInstanceOf(VerifierError)
      expect((error as VerifierError).timedOut).toBe(false)
    })
})
