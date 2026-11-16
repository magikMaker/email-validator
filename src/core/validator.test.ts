import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDisposableDomain } from '../disposable'
import { mock } from '../providers/mock'
import { createMemoryCache } from './cache'
import { emailHash } from './hash'
import { createValidator, findingOfStatus } from './validator'
import { gatePolicy, reviewPolicy } from './policy'
import type { DomainCheck } from './types'
import { VERIFIER_STATUSES, VerifierError } from './verifier'
import type { VerifierProvider } from './verifier'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-16T12:00:00.000Z')

/**
 * A provider that never answers unless aborted.
 * @param seen - Collects the signals it was handed
 * @returns The provider
 */
function hangingProvider(seen: AbortSignal[] = []): VerifierProvider {
  return {
    name: 'hanging',
    verify: (_address, options) => {
      if (options?.signal) {
        seen.push(options.signal)
      }
      return new Promise(() => undefined)
    },
  }
}

/**
 * The finding codes of a result.
 * @param result - A result
 * @param result.findings - Its findings
 * @returns The codes
 */
function codes(result: { findings: { code: string }[] }): string[] {
  return result.findings.map((f) => f.code)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createValidator without plugins', () => {
  it('runs the local chain only', async () => {
    const validator = createValidator()
    const result = await validator.validate(' Anna.Lund+x@Gmail.com ')
    expect(result).toEqual({
      normalized: 'anna.lund+x@gmail.com',
      canonical: 'annalund@gmail.com',
      verdict: 'send',
      findings: [],
      domainCheck: null,
      verification: null,
    })
    expect((await validator.validate('anna@mailinator.com')).verdict)
      .toBe('send')
  })

  it('plugs in the disposable list', async () => {
    const validator = createValidator({ disposable: isDisposableDomain })
    const result = await validator.validate('anna@mailinator.com')
    expect(result.verdict).toBe('reject')
    expect(codes(result)).toEqual(['disposable_domain'])
  })
})

describe('createValidator with a provider', () => {
  it('calls the provider only when local checks do not reject',
    async () => {
      const provider = mock()
      const validator = createValidator({
        provider,
        disposable: isDisposableDomain,
      })
      await validator.validate('not an address')
      await validator.validate('anna@gmail.com')
      await validator.validate('anna@mailinator.com')
      await validator.validate('anna@acme.notatld')
      expect(provider.calls).toEqual([])
      // A review (a typo, a role) still asks the provider.
      await validator.validate('info@acme.com')
      await validator.validate('anna@gmial.co')
      expect(provider.calls).toEqual(['info@acme.com', 'anna@gmial.co'])
    })

  it('hands the provider the normalized address and records the answer',
    async () => {
      const provider = mock()
      const validator = createValidator({ provider, now: () => NOW })
      const result = await validator.validate(' Piet@ACME.nl ')
      expect(provider.calls).toEqual(['piet@acme.nl'])
      expect(result.verdict).toBe('send')
      expect(result.findings).toEqual([])
      expect(result.verification).toEqual({
        kind: 'result',
        provider: 'mock',
        status: 'valid',
        source: 'call',
        checkedAt: NOW.toISOString(),
        raw: { provider: 'mock', status: 'valid' },
      })
    })

  it('maps every status through the gate policy by default', async () => {
    const validator = createValidator({ provider: mock() })
    const verdicts: Record<string, string> = {}
    for (const status of VERIFIER_STATUSES) {
      const result = await validator.validate(`anna+${status}@acme.nl`)
      verdicts[status] = result.verdict
      if (status !== 'valid') {
        expect(result.findings.at(-1)?.status).toBe(status)
      }
    }
    expect(verdicts).toEqual({
      valid: 'send',
      invalid: 'reject',
      catch_all: 'send',
      unknown: 'send',
      disposable: 'reject',
      role: 'send',
      spamtrap: 'reject',
      abuse: 'reject',
    })
  })

  it('maps every status through the review policy', async () => {
    const validator = createValidator({ provider: mock(),
      policy: 'review' })
    const verdicts: Record<string, string> = {}
    for (const status of VERIFIER_STATUSES) {
      verdicts[status] =
        (await validator.validate(`anna+${status}@acme.nl`)).verdict
    }
    expect(verdicts).toEqual({
      valid: 'send',
      invalid: 'reject',
      catch_all: 'review',
      unknown: 'review',
      disposable: 'reject',
      role: 'review',
      spamtrap: 'reject',
      abuse: 'reject',
    })
  })

  it('takes a custom policy function', async () => {
    const strict = vi.fn((status: string | null) =>
      status === 'valid' ? 'send' as const : 'reject' as const)
    const validator = createValidator({ provider: mock(), policy: strict })
    expect((await validator.validate('a+catch_all@acme.nl')).verdict)
      .toBe('reject')
    expect(strict).toHaveBeenCalledWith('catch_all')
    const down = createValidator({
      provider: mock({ failure: new Error('down') }),
      policy: strict,
    })
    expect((await down.validate('a@acme.nl')).verdict).toBe('reject')
    expect(strict).toHaveBeenLastCalledWith(null)
  })

  it('keeps the worst verdict of local and verifier findings', async () => {
    const validator = createValidator({ provider: mock() })
    const result = await validator.validate('info+invalid@acme.com')
    expect(codes(result)).toEqual(['role_account', 'mailbox_invalid'])
    expect(result.verdict).toBe('reject')
  })
})

describe('fail open', () => {
  it('reports a provider error as a finding and never throws',
    async () => {
      const errors: unknown[] = []
      const validator = createValidator({
        provider: mock({ failure: new VerifierError('Kickbox answered 503',
          { retryable: true }) }),
        onError: (stage, error) => errors.push([stage, error]),
      })
      const result = await validator.validate('a@acme.nl')
      expect(result.verdict).toBe('send')
      expect(result.findings).toEqual([
        {
          code: 'verifier_failed',
          verdict: 'send',
          message: 'the verifier (mock) gave no answer: Kickbox answered 503',
        },
      ])
      expect(result.verification).toEqual({
        kind: 'failed',
        provider: 'mock',
        error: 'Kickbox answered 503',
        timedOut: false,
      })
      expect(errors).toHaveLength(1)
      expect(errors[0]).toEqual(['provider', expect.any(VerifierError)])
    })

  it('hides the message of a foreign error, which may name the address',
    async () => {
      const validator = createValidator({
        provider: mock({ failure: new Error('a@acme.nl is broken') }),
        policy: 'review',
      })
      const result = await validator.validate('a@acme.nl')
      expect(result.verdict).toBe('review')
      expect(JSON.stringify(result)).not.toContain('is broken')
      expect(result.verification).toMatchObject({
        kind: 'failed',
        error: 'the verification failed',
      })
    })

  it('times out, aborts the provider and allows', async () => {
    vi.useFakeTimers()
    const seen: AbortSignal[] = []
    const validator = createValidator({
      provider: hangingProvider(seen),
      timeoutMs: 1000,
    })
    const pending = validator.validate('a@acme.nl')
    await vi.advanceTimersByTimeAsync(1001)
    const result = await pending
    expect(result.verdict).toBe('send')
    expect(result.verification).toMatchObject({
      kind: 'failed',
      error: 'the verifier timed out',
      timedOut: true,
    })
    expect(seen[0]?.aborted).toBe(true)
  })

  it('stops at the caller signal', async () => {
    const seen: AbortSignal[] = []
    const validator = createValidator({ provider: hangingProvider(seen) })
    const controller = new AbortController()
    const pending = validator.validate('a@acme.nl', {
      signal: controller.signal,
    })
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    const result = await pending
    expect(result.verification).toMatchObject({
      kind: 'failed',
      error: 'the verification was aborted',
      timedOut: false,
    })
    expect(seen[0]?.aborted).toBe(true)
    const again = await validator.validate('a@acme.nl', {
      signal: controller.signal,
    })
    expect(again.verification).toMatchObject({ kind: 'failed' })
  })

  it('rejects a provider answer with an unknown status', async () => {
    const odd: VerifierProvider = {
      name: 'odd',
      verify: async () => ({ status: 'maybe' as 'valid', raw: {} }),
    }
    const result = await createValidator({ provider: odd })
      .validate('a@acme.nl')
    expect(result.verification).toMatchObject({
      kind: 'failed',
      error: 'the provider gave an unknown status',
    })
  })

  it('survives an onError that throws', async () => {
    const validator = createValidator({
      provider: mock({ failure: new Error('down') }),
      onError: () => {
        throw new Error('logger down')
      },
    })
    expect((await validator.validate('a@acme.nl')).verdict).toBe('send')
  })
})

describe('the cache', () => {
  it('stores by hash and never pays twice for a fresh answer',
    async () => {
      const cache = createMemoryCache()
      const provider = mock({ statuses: { 'bad@acme.nl': 'invalid' } })
      const validator = createValidator({ provider, cache,
        now: () => NOW })
      await validator.validate('Bad@acme.nl')
      const again = await validator.validate(' bad@ACME.nl')
      expect(provider.calls).toEqual(['bad@acme.nl'])
      expect(again.verdict).toBe('reject')
      expect(again.verification).toMatchObject({
        kind: 'result',
        source: 'cache',
        status: 'invalid',
      })
      const stored = await cache.get(await emailHash('bad@acme.nl'))
      expect(stored).toEqual({
        provider: 'mock',
        status: 'invalid',
        raw: { provider: 'mock', status: 'invalid' },
        checkedAt: NOW.toISOString(),
        source: 'api',
      })
      expect(cache.size).toBe(1)
    })

  it('calls again once an answer is older than 30 days', async () => {
    const cache = createMemoryCache()
    const fresh = await emailHash('fresh@acme.nl')
    const old = await emailHash('old@acme.nl')
    await cache.set(fresh, { provider: 'mock', status: 'invalid', raw: {},
      checkedAt: new Date(NOW.getTime() - 29 * DAY).toISOString() })
    await cache.set(old, { provider: 'mock', status: 'invalid', raw: {},
      checkedAt: new Date(NOW.getTime() - 31 * DAY).toISOString() })
    const provider = mock()
    const validator = createValidator({ provider, cache, now: () => NOW })
    expect((await validator.validate('fresh@acme.nl')).verdict)
      .toBe('reject')
    expect((await validator.validate('old@acme.nl')).verdict).toBe('send')
    expect(provider.calls).toEqual(['old@acme.nl'])
    expect((await cache.get(old))?.status).toBe('valid')
  })

  it('takes a custom staleness and ignores garbled entries', async () => {
    const cache = createMemoryCache()
    await cache.set(await emailHash('a@acme.nl'), { provider: 'mock',
      status: 'invalid', raw: {},
      checkedAt: new Date(NOW.getTime() - 2 * DAY).toISOString() })
    await cache.set(await emailHash('b@acme.nl'), { provider: 'mock',
      status: 'nonsense' as 'valid', raw: {}, checkedAt: NOW.toISOString() })
    await cache.set(await emailHash('c@acme.nl'), { provider: 'mock',
      status: 'invalid', raw: {}, checkedAt: 'yesterday' })
    const provider = mock()
    const validator = createValidator({ provider, cache, now: () => NOW,
      staleAfterMs: DAY })
    await validator.validate('a@acme.nl')
    await validator.validate('b@acme.nl')
    await validator.validate('c@acme.nl')
    expect(provider.calls).toEqual(['a@acme.nl', 'b@acme.nl', 'c@acme.nl'])
  })

  it('verifies anyway when the cache fails, and reports it', async () => {
    const stages: string[] = []
    const provider = mock()
    const validator = createValidator({
      provider,
      cache: {
        get: async () => {
          throw new Error('d1 down')
        },
        set: async () => {
          throw new Error('d1 down')
        },
      },
      onError: (stage) => stages.push(stage),
    })
    const result = await validator.validate('a+invalid@acme.nl')
    expect(result.verdict).toBe('reject')
    expect(stages).toEqual(['cache_read', 'cache_write'])
  })

  it('does not cache a failure', async () => {
    const cache = createMemoryCache()
    const validator = createValidator({
      provider: mock({ failure: new Error('down') }),
      cache,
    })
    await validator.validate('a@acme.nl')
    expect(cache.size).toBe(0)
  })
})

describe('the budget', () => {
  it('skips the call when the budget says no or throws', async () => {
    let left = 1
    const provider = mock()
    const stages: string[] = []
    const validator = createValidator({
      provider,
      budget: () => left-- > 0,
      onError: (stage) => stages.push(stage),
    })
    expect((await validator.validate('a@acme.nl')).verification)
      .toMatchObject({ kind: 'result', source: 'call' })
    const skipped = await validator.validate('b@acme.nl')
    expect(skipped.verdict).toBe('send')
    expect(skipped.verification).toEqual({
      kind: 'skipped',
      provider: 'mock',
      reason: 'budget',
    })
    expect(codes(skipped)).toEqual(['verifier_skipped'])
    expect(provider.calls).toEqual(['a@acme.nl'])

    const broken = createValidator({
      provider,
      policy: 'review',
      budget: async () => {
        throw new Error('kv down')
      },
      onError: (stage) => stages.push(stage),
    })
    expect((await broken.validate('c@acme.nl')).verdict).toBe('review')
    expect(stages).toEqual(['budget'])
  })

  it('reads the cache before it asks the budget', async () => {
    const cache = createMemoryCache()
    await cache.set(await emailHash('a@acme.nl'), { provider: 'mock',
      status: 'valid', raw: {}, checkedAt: NOW.toISOString() })
    const budget = vi.fn(() => false)
    const validator = createValidator({ provider: mock(), cache, budget,
      now: () => NOW })
    await validator.validate('a@acme.nl')
    expect(budget).not.toHaveBeenCalled()
  })
})

describe('the DNS check', () => {
  it('rejects an undeliverable domain before any provider call',
    async () => {
      const dns = vi.fn<DomainCheck>(async (domain) =>
        domain === 'nomail.org' ? 'undeliverable' : 'ok')
      const provider = mock()
      const validator = createValidator({ provider, dns })
      const result = await validator.validate('Anna@NoMail.org')
      expect(dns).toHaveBeenCalledWith('nomail.org', {})
      expect(result.verdict).toBe('reject')
      expect(result.domainCheck).toBe('undeliverable')
      expect(codes(result)).toEqual(['domain_undeliverable'])
      expect(provider.calls).toEqual([])
      const ok = await validator.validate('anna@acme.org')
      expect(ok.domainCheck).toBe('ok')
      expect(provider.calls).toEqual(['anna@acme.org'])
    })

  it('skips DNS after a local reject and passes the signal on',
    async () => {
      const dns = vi.fn<DomainCheck>(async () => 'ok')
      const validator = createValidator({ dns })
      await validator.validate('anna@example.com')
      expect(dns).not.toHaveBeenCalled()
      const controller = new AbortController()
      await validator.validate('anna@acme.org', {
        signal: controller.signal,
      })
      expect(dns).toHaveBeenCalledWith('acme.org', {
        signal: controller.signal,
      })
    })

  it('fails open when a DNS check throws', async () => {
    const stages: string[] = []
    const validator = createValidator({
      dns: async () => {
        throw new Error('boom')
      },
      onError: (stage) => stages.push(stage),
    })
    const result = await validator.validate('anna@acme.org')
    expect(result.domainCheck).toBe('ok')
    expect(result.verdict).toBe('send')
    expect(stages).toEqual(['dns'])
  })
})

describe('findingOfStatus', () => {
  it('has no finding for valid and no dashes in any text', () => {
    expect(findingOfStatus('valid', gatePolicy)).toBeNull()
    for (const status of VERIFIER_STATUSES) {
      const finding = findingOfStatus(status, reviewPolicy)
      expect(finding?.message ?? '').not.toMatch(/[\u2013\u2014]/)
    }
  })
})
