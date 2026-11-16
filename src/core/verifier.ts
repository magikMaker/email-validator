/**
 * The provider agnostic contract of a third party email verifier: one
 * call per address, a status from a fixed set, and the provider's answer
 * for the record. Each provider maps its own API onto these statuses;
 * the validator (`createValidator`) owns timeouts, abort, fail open and
 * the policy that turns a status into a verdict, identically for every
 * provider.
 */

/** What a verifier says about an address. */
export type VerifierStatus =
  /** The mailbox exists and accepts mail. */
  | 'valid'
  /** The mailbox or its domain does not accept mail. */
  | 'invalid'
  /** The domain accepts every address, so the mailbox is unconfirmed. */
  | 'catch_all'
  /** The provider could not tell (timeout at the mail server, greylist). */
  | 'unknown'
  /** A throwaway mailbox service. */
  | 'disposable'
  /** A role address (`info@`, `support@`), not a person. */
  | 'role'
  /** A known spam trap. */
  | 'spamtrap'
  /** An address known for abuse or spam complaints. */
  | 'abuse'

/** Every status, for validation. */
export const VERIFIER_STATUSES: readonly VerifierStatus[] = [
  'valid',
  'invalid',
  'catch_all',
  'unknown',
  'disposable',
  'role',
  'spamtrap',
  'abuse',
]

/** The answer of one verification. */
export interface VerifierResult {
  /** The provider's answer mapped onto the shared statuses. */
  status: VerifierStatus
  /**
   * The provider's answer, kept for the record. Providers remove the
   * address fields before handing it back, so it can be stored.
   */
  raw: unknown
}

/** What the validator hands a provider with each call. */
export interface VerifyOptions {
  /** Aborts the call: the validator's timeout or the caller's signal. */
  signal?: AbortSignal
}

/**
 * A verification provider: Kickbox, a mock, or your own. Implement this
 * interface to add one; see the README, "Writing a provider".
 */
export interface VerifierProvider {
  /** The provider's name as stored with a result, e.g. `kickbox`. */
  readonly name: string
  /**
   * Verify one address.
   * @param address - The address, trimmed and lowercased
   * @param options - The abort signal; honour it to stop paying for a
   *   call nobody waits for
   * @returns The status and the provider's answer without address fields
   * @throws {VerifierError} When the provider gave no usable answer
   */
  verify(address: string, options?: VerifyOptions): Promise<VerifierResult>
}

/** How a {@link VerifierError} is set up. */
export interface VerifierErrorOptions {
  /** True when a later attempt may succeed (rate limit, outage). */
  retryable?: boolean
  /** True when the call ran out of time. */
  timedOut?: boolean
}

/**
 * A verification that produced no result. Its message never carries the
 * address or an API key, so it can be logged.
 */
export class VerifierError extends Error {
  /** True when a later attempt may succeed (rate limit, outage). */
  readonly retryable: boolean
  /** True when the call ran out of time. */
  readonly timedOut: boolean

  /**
   * @param message - What went wrong, without the address
   * @param options - See {@link VerifierErrorOptions}
   */
  constructor(message: string, options: VerifierErrorOptions = {}) {
    super(message)
    this.name = 'VerifierError'
    this.retryable = options.retryable ?? false
    this.timedOut = options.timedOut ?? false
  }
}

/**
 * Whether a value is a verifier status.
 * @param value - Anything
 * @returns True for one of {@link VERIFIER_STATUSES}
 */
export function isVerifierStatus(value: unknown): value is VerifierStatus {
  return (
    typeof value === 'string' &&
    (VERIFIER_STATUSES as readonly string[]).includes(value)
  )
}
