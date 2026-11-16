import { describe, expect, it } from 'vitest'
import { DEFAULT_STALE_AFTER_MS, createMemoryCache, isStale } from './cache'

const NOW = new Date('2026-11-16T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('isStale', () => {
  it('keeps answers fresh for 30 days by default', () => {
    expect(DEFAULT_STALE_AFTER_MS).toBe(30 * DAY)
    const at = (days: number): string =>
      new Date(NOW.getTime() - days * DAY).toISOString()
    expect(isStale(at(29), NOW)).toBe(false)
    expect(isStale(at(30), NOW)).toBe(false)
    expect(isStale(at(31), NOW)).toBe(true)
    expect(isStale(at(2), NOW, DAY)).toBe(true)
    expect(isStale('not a date', NOW)).toBe(true)
  })
})

describe('createMemoryCache', () => {
  it('stores, replaces, clears and stays bounded', async () => {
    const cache = createMemoryCache({ maxEntries: 2 })
    const entry = { provider: 'mock', status: 'valid' as const, raw: {},
      checkedAt: NOW.toISOString() }
    expect(await cache.get('a')).toBeNull()
    await cache.set('a', entry)
    await cache.set('b', entry)
    await cache.set('a', { ...entry, status: 'invalid' })
    await cache.set('c', entry)
    expect(await cache.get('b')).toBeNull()
    expect((await cache.get('a'))?.status).toBe('invalid')
    expect(cache.size).toBe(2)
    cache.clear()
    expect(cache.size).toBe(0)
  })
})
