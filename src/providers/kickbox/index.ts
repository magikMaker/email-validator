/**
 * `@magikmaker/email-validator/providers/kickbox`: the Kickbox provider.
 * One call per address to the single verification API,
 * `GET https://api.kickbox.com/v2/verify?email=...&apikey=...`, with
 * plain `fetch`, so it runs on Workers, Node and Deno (the official
 * `kickbox` npm client is Node only).
 *
 * Kickbox answers (https://docs.kickbox.com/docs/single-verification-api):
 * - `result`: `deliverable`, `undeliverable`, `risky`, `unknown`
 * - `reason`: `invalid_email`, `invalid_domain`, `rejected_email`,
 *   `accepted_email`, `low_quality`, `low_deliverability`, `no_connect`,
 *   `timeout`, `invalid_smtp`, `unavailable_smtp`, `unexpected_error`
 * - flags `role`, `free`, `disposable`, `accept_all`; `did_you_mean`,
 *   `sendex` (0 to 1); `email`, `user`, `domain`; `success`, `message`
 *
 * The status (see {@link kickboxStatusOf}): a disposable domain first,
 * then `undeliverable` is `invalid`, an accept all domain `catch_all`, a
 * role address `role`, `deliverable` `valid`, everything else (`risky`,
 * `unknown`) `unknown`. Kickbox reports no spam traps or abuse
 * addresses, so those statuses never come from here.
 *
 * Neither the address nor the key ever appears in an error; the `raw`
 * answer drops the address fields (`email`, `user`) and keeps only the
 * domain of a `did_you_mean` suggestion.
 */

import { VerifierError } from '../../core/verifier.js'
import type {
  VerifierProvider,
  VerifierResult,
  VerifierStatus,
  VerifyOptions,
} from '../../core/verifier.js'

/** Kickbox's API base. */
export const KICKBOX_API_BASE = 'https://api.kickbox.com/v2'

/**
 * The verification timeout asked of Kickbox by default, in milliseconds.
 * Past it Kickbox answers `unknown` with the reason `timeout`. Short, for
 * a request path; a batch run may ask 6000 or more.
 */
export const KICKBOX_TIMEOUT_MS = 3000

/** Our own request timeout sits this much above Kickbox's. */
export const KICKBOX_REQUEST_TIMEOUT_MARGIN_MS = 1500

/**
 * Attempts per address by default: one, for a request path. A batch run
 * may allow 3, so a 429 or 5xx is retried with backoff.
 */
export const KICKBOX_MAX_ATTEMPTS = 1

/** The first backoff; doubled per retry. */
const BACKOFF_BASE_MS = 500

/** The longest wait a `Retry-After` header may ask for. */
const MAX_BACKOFF_MS = 5000

/** The fields of Kickbox's answer this provider reads. */
export interface KickboxResponse {
  /** `deliverable`, `undeliverable`, `risky` or `unknown`. */
  result?: string
  /** Why, e.g. `rejected_email`. */
  reason?: string
  /** A role address. */
  role?: boolean
  /** A free mail provider. */
  free?: boolean
  /** A disposable domain. */
  disposable?: boolean
  /** The domain accepts every address. */
  accept_all?: boolean
  /** A suggested correction, a full address. */
  did_you_mean?: string | null
  /** Kickbox's quality score, 0 to 1. */
  sendex?: number
  /** The address. */
  email?: string
  /** The local part. */
  user?: string
  /** The domain. */
  domain?: string
  /** False when the request was refused. */
  success?: boolean
  /** Why a request was refused. */
  message?: string | null
}

/** Kickbox's answer as it is handed back: no address fields. */
export interface KickboxRawRecord {
  /** Always `kickbox`. */
  provider: 'kickbox'
  /** Kickbox's result. */
  result: string | null
  /** Kickbox's reason. */
  reason: string | null
  /** A role address. */
  role: boolean
  /** A free mail provider. */
  free: boolean
  /** A disposable domain. */
  disposable: boolean
  /** The domain accepts every address. */
  acceptAll: boolean
  /** Kickbox's quality score, 0 to 1. */
  sendex: number | null
  /** The domain of the address. */
  domain: string | null
  /** The domain of `did_you_mean`, never its local part. */
  didYouMeanDomain: string | null
}

/**
 * The verifier status of a Kickbox answer.
 * @param answer - The answer (or a bulk CSV row read into its shape)
 * @returns The status
 */
export function kickboxStatusOf(answer: KickboxResponse): VerifierStatus {
  const result = (answer.result ?? '').trim().toLowerCase()
  if (answer.disposable === true) {
    return 'disposable'
  }
  if (result === 'undeliverable') {
    return 'invalid'
  }
  if (answer.accept_all === true) {
    return 'catch_all'
  }
  if (answer.role === true) {
    return 'role'
  }
  return result === 'deliverable' ? 'valid' : 'unknown'
}

/**
 * The domain of an address, or null.
 * @param address - An address or null
 * @returns The part after the last `@`, lowercased
 */
function domainPart(address: string | null | undefined): string | null {
  if (!address) {
    return null
  }
  const at = address.lastIndexOf('@')
  if (at < 0) {
    return null
  }
  return address.slice(at + 1).trim().toLowerCase() || null
}

/**
 * Kickbox's answer without the address, as it may be stored.
 * @param answer - The answer
 * @returns The record
 */
export function kickboxRawRecord(answer: KickboxResponse): KickboxRawRecord {
  return {
    provider: 'kickbox',
    result: answer.result ?? null,
    reason: answer.reason ?? null,
    role: answer.role === true,
    free: answer.free === true,
    disposable: answer.disposable === true,
    acceptAll: answer.accept_all === true,
    sendex: typeof answer.sendex === 'number' ? answer.sendex : null,
    domain: answer.domain ?? domainPart(answer.email),
    didYouMeanDomain: domainPart(answer.did_you_mean),
  }
}

/** How {@link kickbox} is set up. */
export interface KickboxOptions {
  /** Your Kickbox API key. */
  apiKey: string
  /**
   * The verification timeout asked of Kickbox, in milliseconds;
   * {@link KICKBOX_TIMEOUT_MS} when unset. The request itself is given
   * {@link KICKBOX_REQUEST_TIMEOUT_MARGIN_MS} more.
   */
  timeoutMs?: number
  /** Attempts per address; {@link KICKBOX_MAX_ATTEMPTS} when unset. */
  maxAttempts?: number
  /** The fetch to use; the global one when unset. */
  fetch?: typeof fetch
  /** The API base; {@link KICKBOX_API_BASE} when unset. */
  apiBase?: string
  /** How to wait between retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Wait a while.
 * @param ms - Milliseconds
 * @returns Resolves after the wait
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The wait before retry `attempt` (1 based): `Retry-After` seconds when
 * Kickbox sends it, else 500 ms doubled per attempt, at most 5 s.
 * @param attempt - The attempt that failed
 * @param retryAfter - The header's value, if any
 * @returns Milliseconds
 */
export function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : BACKOFF_BASE_MS * 2 ** (attempt - 1)
  return Math.min(Math.max(ms, 0), MAX_BACKOFF_MS)
}

/** A 429 or 5xx, retried after the backoff. */
class KickboxRetryError extends VerifierError {
  /** The `Retry-After` header, if any. */
  readonly retryAfter: string | null

  /**
   * @param message - What happened
   * @param retryAfter - The header's value
   */
  constructor(message: string, retryAfter: string | null) {
    super(message, { retryable: true })
    this.retryAfter = retryAfter
  }
}

/** The Kickbox provider, with its name and settings. */
export interface KickboxProvider extends VerifierProvider {
  /** Always `kickbox`. */
  readonly name: 'kickbox'
}

/**
 * The Kickbox provider: one request per address, a 429 or 5xx retried
 * with backoff while attempts are left, the validator's signal honoured
 * between and during attempts.
 * @param options - See {@link KickboxOptions}
 * @returns The provider, ready for `createValidator({ provider })`
 */
export function kickbox(options: KickboxOptions): KickboxProvider {
  const apiKey = options.apiKey
  const apiBase = (options.apiBase ?? KICKBOX_API_BASE).replace(/\/+$/, '')
  const fetchFn =
    options.fetch ??
    ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      fetch(input, init))
  const sleep = options.sleep ?? defaultSleep
  const timeoutMs = Math.max(1, options.timeoutMs ?? KICKBOX_TIMEOUT_MS)
  const maxAttempts = Math.max(1, options.maxAttempts ?? KICKBOX_MAX_ATTEMPTS)

  /**
   * One request.
   * @param email - The address
   * @param signal - The caller's signal
   * @returns Kickbox's answer
   */
  async function request(
    email: string,
    signal: AbortSignal | undefined
  ): Promise<KickboxResponse> {
    const query = new URLSearchParams({
      email,
      apikey: apiKey,
      timeout: String(timeoutMs),
    })
    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs + KICKBOX_REQUEST_TIMEOUT_MARGIN_MS
    )
    let response: Response
    try {
      response = await fetchFn(`${apiBase}/verify?${query}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch {
      throw new VerifierError('Kickbox could not be reached', {
        retryable: true,
        timedOut: controller.signal.aborted && !signal?.aborted,
      })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    if (response.status === 429 || response.status >= 500) {
      throw new KickboxRetryError(
        `Kickbox answered ${response.status}`,
        response.headers.get('Retry-After')
      )
    }
    let body: KickboxResponse
    try {
      body = (await response.json()) as KickboxResponse
    } catch {
      throw new VerifierError(`Kickbox answered ${response.status}, no JSON`)
    }
    if (!response.ok || body.success === false) {
      // Kickbox's message names the problem (an invalid key, an empty
      // balance), never the address.
      const message =
        typeof body.message === 'string' ? body.message.slice(0, 200) : ''
      throw new VerifierError(
        `Kickbox refused the request (${response.status})` +
          (message ? `: ${message}` : '')
      )
    }
    return body
  }

  return {
    name: 'kickbox',
    async verify(
      address: string,
      call: VerifyOptions = {}
    ): Promise<VerifierResult> {
      let last: VerifierError | null = null
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (call.signal?.aborted) {
          throw new VerifierError('the verification was aborted')
        }
        try {
          const answer = await request(address, call.signal)
          return {
            status: kickboxStatusOf(answer),
            raw: kickboxRawRecord(answer),
          }
        } catch (error) {
          const failure =
            error instanceof VerifierError
              ? error
              : new VerifierError('Kickbox request failed', {
                  retryable: true,
                })
          if (!failure.retryable || attempt === maxAttempts) {
            throw failure
          }
          last = failure
          await sleep(
            failure instanceof KickboxRetryError
              ? backoffMs(attempt, failure.retryAfter)
              : backoffMs(attempt, null)
          )
        }
      }
      throw last ?? new VerifierError('Kickbox request failed')
    },
  }
}
