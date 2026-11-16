/**
 * `@magikmaker/email-validator/providers/mock`: a provider that calls
 * nobody, for tests and dry runs. It answers from a map of addresses,
 * then from a `+status` tag in the local part
 * (`anna+catch_all@acme.com` is `catch_all`), then the fallback (`valid`
 * unless set). It can also fail or be slow on purpose, to try the fail
 * open paths.
 */

import { VerifierError, isVerifierStatus } from '../../core/verifier.js'
import type {
  VerifierProvider,
  VerifierResult,
  VerifierStatus,
  VerifyOptions,
} from '../../core/verifier.js'

/** How {@link mock} answers. */
export interface MockOptions {
  /** Fixed answers by address (any case). */
  statuses?: Readonly<Record<string, VerifierStatus>>
  /** The answer for any other address; `valid` when unset. */
  fallback?: VerifierStatus
  /** Throw this instead of answering (tests of the fail open path). */
  failure?: Error
  /** Wait this long before answering; an abort ends the wait. */
  delayMs?: number
  /** The provider name; `mock` when unset. */
  name?: string
}

/** The mock provider, with the addresses it was asked about. */
export interface MockProvider extends VerifierProvider {
  /** Addresses verified so far, normalized, in order. */
  readonly calls: string[]
}

/**
 * Wait, or reject when the signal aborts first.
 * @param ms - Milliseconds
 * @param signal - The abort signal
 * @returns Resolves after the wait
 */
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new VerifierError('the verification was aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    /** Stop waiting on abort. */
    function onAbort(): void {
      clearTimeout(timer)
      reject(new VerifierError('the verification was aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * The mock provider.
 * @param options - See {@link MockOptions}
 * @returns The provider, ready for `createValidator({ provider })`
 */
export function mock(options: MockOptions = {}): MockProvider {
  const statuses = new Map(
    Object.entries(options.statuses ?? {}).map(([email, status]) => [
      email.trim().toLowerCase(),
      status,
    ])
  )
  const fallback = options.fallback ?? 'valid'
  const name = options.name ?? 'mock'
  const calls: string[] = []
  return {
    name,
    calls,
    async verify(
      address: string,
      call: VerifyOptions = {}
    ): Promise<VerifierResult> {
      const key = address.trim().toLowerCase()
      calls.push(key)
      if (options.delayMs && options.delayMs > 0) {
        await wait(options.delayMs, call.signal)
      }
      if (options.failure) {
        throw options.failure
      }
      const tag = /\+([a-z_]+)@/.exec(key)?.[1]
      const status =
        statuses.get(key) ?? (isVerifierStatus(tag) ? tag : fallback)
      return { status, raw: { provider: name, status } }
    },
  }
}
