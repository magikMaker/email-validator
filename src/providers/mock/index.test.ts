import { describe, expect, it } from 'vitest'
import { VerifierError } from '../../core/verifier'
import { mock } from './index'

describe('mock provider', () => {
  it('answers from its map, a +status tag, then the fallback', async () => {
    const provider = mock({ statuses: { 'Bad@Acme.nl': 'invalid' } })
    expect(provider.name).toBe('mock')
    expect((await provider.verify('bad@acme.nl')).status).toBe('invalid')
    expect((await provider.verify('a+catch_all@acme.nl')).status)
      .toBe('catch_all')
    expect((await provider.verify('a+nonsense@acme.nl')).status)
      .toBe('valid')
    expect(provider.calls).toEqual([
      'bad@acme.nl',
      'a+catch_all@acme.nl',
      'a+nonsense@acme.nl',
    ])
  })

  it('has a fallback, a name and a raw answer naming itself', async () => {
    const provider = mock({ fallback: 'unknown', name: 'dry-run' })
    const result = await provider.verify('x@acme.nl')
    expect(result).toEqual({
      status: 'unknown',
      raw: { provider: 'dry-run', status: 'unknown' },
    })
  })

  it('fails on purpose and waits until aborted', async () => {
    const failing = mock({ failure: new VerifierError('down') })
    await expect(failing.verify('x@acme.nl')).rejects.toThrow('down')

    const slow = mock({ delayMs: 60_000 })
    const controller = new AbortController()
    const pending = slow.verify('x@acme.nl', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(VerifierError)
    await expect(
      slow.verify('x@acme.nl', { signal: controller.signal })
    ).rejects.toThrow('aborted')

    const quick = mock({ delayMs: 1 })
    expect((await quick.verify('x@acme.nl')).status).toBe('valid')
  })
})
