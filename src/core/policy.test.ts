import { describe, expect, it } from 'vitest'
import { gatePolicy, policyOf, reviewPolicy } from './policy'

describe('policies', () => {
  it('gate refuses only what takes no mail and fails open', () => {
    expect(gatePolicy('invalid')).toBe('reject')
    expect(gatePolicy('disposable')).toBe('reject')
    expect(gatePolicy('spamtrap')).toBe('reject')
    expect(gatePolicy('abuse')).toBe('reject')
    for (const status of ['valid', 'catch_all', 'unknown', 'role'] as const) {
      expect(gatePolicy(status), status).toBe('send')
    }
    expect(gatePolicy(null)).toBe('send')
  })

  it('review sends only valid and reviews what nobody vouched for', () => {
    expect(reviewPolicy('valid')).toBe('send')
    for (const status of ['invalid', 'disposable', 'spamtrap',
      'abuse'] as const) {
      expect(reviewPolicy(status), status).toBe('reject')
    }
    for (const status of ['catch_all', 'unknown', 'role'] as const) {
      expect(reviewPolicy(status), status).toBe('review')
    }
    expect(reviewPolicy(null)).toBe('review')
  })

  it('resolves names and functions, gate by default', () => {
    const custom = (): 'send' => 'send'
    expect(policyOf(undefined)).toBe(gatePolicy)
    expect(policyOf('gate')).toBe(gatePolicy)
    expect(policyOf('review')).toBe(reviewPolicy)
    expect(policyOf(custom)).toBe(custom)
  })
})
