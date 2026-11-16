/**
 * The verifier result cache contract. The validator reads it before it
 * pays for a call and writes every answer to it, keyed by the address
 * hash (`emailHash`), never the address. Projects plug in D1, KV, Redis
 * or anything else; {@link createMemoryCache} is the in-memory one for
 * tests and single process scripts.
 */

import type { VerifierStatus } from './verifier.js'

/** How long a cached answer stays fresh by default: 30 days. */
export const DEFAULT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

/** A cached verifier answer. */
export interface CachedResult {
  /** The provider that answered, e.g. `kickbox`. */
  provider: string
  /** The status it gave. */
  status: VerifierStatus
  /** Its answer without address fields. */
  raw: unknown
  /** When the address was verified, ISO 8601 UTC. */
  checkedAt: string
  /** Where the answer came from, e.g. `api` or `csv`. */
  source?: string
}

/** Where verifier answers are kept between calls. */
export interface VerifierCache {
  /**
   * The answer stored under a key, or null. Staleness is the validator's
   * business, so a store may hand back old entries.
   * @param key - The address hash
   * @returns The entry or null
   */
  get(key: string): Promise<CachedResult | null>
  /**
   * Store an answer, replacing the key's earlier one.
   * @param key - The address hash
   * @param result - The answer
   * @returns Resolves once stored
   */
  set(key: string, result: CachedResult): Promise<void>
}

/**
 * Whether a cached answer is too old to use. An unreadable date is stale.
 * @param checkedAt - When the address was verified (ISO)
 * @param now - The moment
 * @param staleAfterMs - How long an answer stays fresh
 * @returns True when the answer must be fetched again
 */
export function isStale(
  checkedAt: string,
  now: Date,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS
): boolean {
  const at = Date.parse(checkedAt)
  return !Number.isFinite(at) || now.getTime() - at > staleAfterMs
}

/** Options of {@link createMemoryCache}. */
export interface MemoryCacheOptions {
  /** Entries kept at most; the oldest goes first. 10,000 when unset. */
  maxEntries?: number
}

/** An in-memory {@link VerifierCache} with a few helpers for tests. */
export interface MemoryCache extends VerifierCache {
  /** Entries held now. */
  readonly size: number
  /** Forget every entry. */
  clear(): void
}

/**
 * An in-memory cache, bounded, oldest entry out first.
 * @param options - See {@link MemoryCacheOptions}
 * @returns The cache
 */
export function createMemoryCache(
  options: MemoryCacheOptions = {}
): MemoryCache {
  const maxEntries = Math.max(1, options.maxEntries ?? 10_000)
  const entries = new Map<string, CachedResult>()
  return {
    get size(): number {
      return entries.size
    },
    clear(): void {
      entries.clear()
    },
    async get(key: string): Promise<CachedResult | null> {
      return entries.get(key) ?? null
    },
    async set(key: string, result: CachedResult): Promise<void> {
      entries.delete(key)
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next()
        if (oldest.done) {
          break
        }
        entries.delete(oldest.value)
      }
      entries.set(key, result)
    },
  }
}
