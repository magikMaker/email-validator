/**
 * The full chain as one async call: the local checks first, then the
 * optional DNS check, then the optional verifier, each only when the
 * steps before did not already reject. Timeouts, abort, the cache and
 * fail open live here, the same for every provider: a provider outage
 * becomes a finding (its verdict set by the policy) and never an
 * exception. Nothing here logs; `onError` hands failures to the caller,
 * and no message it gets carries the address.
 */

import { DEFAULT_STALE_AFTER_MS, isStale } from './cache.js'
import type { VerifierCache } from './cache.js'
import { emailHash } from './hash.js'
import { policyOf } from './policy.js'
import type { PolicyName, VerifierPolicy } from './policy.js'
import type {
  DisposableCheck,
  DomainCheck,
  DomainVerdict,
  EmailFinding,
  EmailFindingCode,
  EmailValidation,
} from './types.js'
import { validateEmailAddress, verdictOfFindings } from './validate.js'
import { VerifierError, isVerifierStatus } from './verifier.js'
import type {
  VerifierProvider,
  VerifierResult,
  VerifierStatus,
} from './verifier.js'

/** How long the validator waits for a provider by default. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 5000

/** The stage of the chain a reported failure comes from. */
export type ValidatorStage =
  | 'dns'
  | 'cache_read'
  | 'cache_write'
  | 'budget'
  | 'provider'

/** How {@link createValidator} is set up. */
export interface ValidatorOptions {
  /** The verification provider; no verification when unset. */
  provider?: VerifierProvider
  /** Where answers are cached; every call goes out when unset. */
  cache?: VerifierCache
  /** The disposable domain check (`isDisposableDomain` of `/disposable`). */
  disposable?: DisposableCheck
  /** The DNS check (`createDomainCheck()` of `/dns`). */
  dns?: DomainCheck
  /** How a status becomes a verdict: `gate` (default), `review`, or yours. */
  policy?: PolicyName | VerifierPolicy
  /** How long a provider call may take; 5 seconds when unset. */
  timeoutMs?: number
  /** How long a cached answer stays fresh; 30 days when unset. */
  staleAfterMs?: number
  /**
   * Asked before every paid call; false skips the call (a daily cap, for
   * example). A budget that throws counts as false: no paid call goes
   * out when the guard cannot count.
   */
  budget?: () => boolean | Promise<boolean>
  /** The clock, for staleness and `checkedAt` (tests). */
  now?: () => Date
  /**
   * Hears about every failure the chain absorbed. Errors from this
   * library never carry the address.
   */
  onError?: (stage: ValidatorStage, error: unknown) => void
}

/** Options of one {@link Validator.validate} call. */
export interface ValidateCallOptions {
  /** Aborts the DNS lookup and the provider call. */
  signal?: AbortSignal
}

/** What happened at the verifier. */
export type VerificationOutcome =
  | {
      kind: 'result'
      /** The provider that answered. */
      provider: string
      /** Its status. */
      status: VerifierStatus
      /** `cache` when a fresh cached answer was used, `call` otherwise. */
      source: 'cache' | 'call'
      /** When the address was verified, ISO 8601 UTC. */
      checkedAt: string
      /** The provider's answer without address fields. */
      raw: unknown
    }
  | {
      kind: 'failed'
      /** The provider that failed. */
      provider: string
      /** What went wrong, without the address. */
      error: string
      /** True when the call ran out of time. */
      timedOut: boolean
    }
  | {
      kind: 'skipped'
      /** The provider that was not called. */
      provider: string
      /** Why: the budget said no. */
      reason: 'budget'
    }

/** What {@link Validator.validate} found. */
export interface ValidatorResult extends EmailValidation {
  /** The DNS verdict, or null when DNS was not asked. */
  domainCheck: DomainVerdict | null
  /** What the verifier did, or null when it was not asked. */
  verification: VerificationOutcome | null
}

/** A configured validator. */
export interface Validator {
  /**
   * Validate one address: local checks, DNS, verifier. Never throws.
   * @param address - The address as typed
   * @param options - See {@link ValidateCallOptions}
   * @returns The verdict, the findings and what DNS and the verifier said
   */
  validate(
    address: string,
    options?: ValidateCallOptions
  ): Promise<ValidatorResult>
}

/** The finding code of each status; `valid` has none. */
const STATUS_CODES: Readonly<
  Record<Exclude<VerifierStatus, 'valid'>, EmailFindingCode>
> = {
  invalid: 'mailbox_invalid',
  disposable: 'mailbox_disposable',
  spamtrap: 'mailbox_spamtrap',
  abuse: 'mailbox_abuse',
  catch_all: 'mailbox_catch_all',
  unknown: 'mailbox_unknown',
  role: 'mailbox_role',
}

/** The text of each status finding. */
const STATUS_MESSAGES: Readonly<
  Record<Exclude<VerifierStatus, 'valid'>, string>
> = {
  invalid: 'the mailbox does not exist or does not accept mail',
  disposable: 'the verifier reports a disposable mailbox',
  spamtrap: 'the verifier reports a spam trap',
  abuse: 'the verifier reports an address known for abuse complaints',
  catch_all:
    'the domain accepts mail for every address, so the mailbox cannot ' +
    'be confirmed',
  unknown: 'the verifier could not tell whether the mailbox exists',
  role: 'the verifier reports a role address, not a person',
}

/**
 * The finding of a verifier status under a policy.
 * @param status - The status
 * @param policy - The policy
 * @returns The finding, or null for `valid`
 */
export function findingOfStatus(
  status: VerifierStatus,
  policy: VerifierPolicy
): EmailFinding | null {
  if (status === 'valid') {
    return null
  }
  return {
    code: STATUS_CODES[status],
    verdict: policy(status),
    message: STATUS_MESSAGES[status],
    status,
  }
}

/**
 * A short, address free description of an error.
 * @param error - Anything thrown
 * @returns The message of a `VerifierError`, a generic text otherwise
 */
function describe(error: unknown): string {
  return error instanceof VerifierError
    ? error.message
    : 'the verification failed'
}

/**
 * One provider call bounded by a timer and the caller's signal. The
 * provider gets a signal that aborts on either, so a well behaved one
 * stops its request; the race makes sure the validator stops waiting
 * even when it does not.
 * @param provider - The provider
 * @param address - The address, normalized
 * @param timeoutMs - The wait
 * @param outer - The caller's signal
 * @returns The answer
 * @throws {VerifierError} On timeout or abort; the provider's own
 *   error otherwise
 */
async function verifyWithin(
  provider: VerifierProvider,
  address: string,
  timeoutMs: number,
  outer: AbortSignal | undefined
): Promise<VerifierResult> {
  if (outer?.aborted) {
    throw new VerifierError('the verification was aborted')
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onOuterAbort: (() => void) | undefined
  const stop = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new VerifierError('the verifier timed out', {
          retryable: true,
          timedOut: true,
        })
      )
      controller.abort()
    }, timeoutMs)
    onOuterAbort = (): void => {
      reject(new VerifierError('the verification was aborted'))
      controller.abort()
    }
    outer?.addEventListener('abort', onOuterAbort, { once: true })
  })
  try {
    return await Promise.race([
      provider.verify(address, { signal: controller.signal }),
      stop,
    ])
  } finally {
    clearTimeout(timer)
    if (onOuterAbort) {
      outer?.removeEventListener('abort', onOuterAbort)
    }
  }
}

/**
 * Make a validator. Every option is optional: without a provider it runs
 * the local checks (and DNS when given) only.
 *
 * The order of one `validate` call:
 * 1. the local chain (`validateEmailAddress`, with `disposable`); a
 *    reject stops here;
 * 2. `dns`: an undeliverable domain rejects and stops here;
 * 3. the cache: a fresh answer is used without a call;
 * 4. `budget`: false skips the call;
 * 5. the provider, within `timeoutMs`; the answer is cached;
 * 6. the policy turns the status (or no answer) into a finding.
 * @param options - See {@link ValidatorOptions}
 * @returns The validator
 */
export function createValidator(options: ValidatorOptions = {}): Validator {
  const policy = policyOf(options.policy)
  const timeoutMs = Math.max(
    1,
    options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS
  )
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const clock = options.now ?? ((): Date => new Date())
  const report = (stage: ValidatorStage, error: unknown): void => {
    try {
      options.onError?.(stage, error)
    } catch {
      // A failing reporter must not break the validation.
    }
  }

  /**
   * Ask the budget, counting a failure as no.
   * @returns True when a paid call may go out
   */
  async function mayCall(): Promise<boolean> {
    if (!options.budget) {
      return true
    }
    try {
      return await options.budget()
    } catch (error) {
      report('budget', error)
      return false
    }
  }

  /**
   * The verification step, cache first.
   * @param provider - The provider
   * @param address - The normalized address
   * @param signal - The caller's signal
   * @returns What happened
   */
  async function verification(
    provider: VerifierProvider,
    address: string,
    signal: AbortSignal | undefined
  ): Promise<VerificationOutcome> {
    const now = clock()
    let key: string | null = null
    if (options.cache) {
      try {
        key = await emailHash(address)
        const cached = await options.cache.get(key)
        if (
          cached &&
          isVerifierStatus(cached.status) &&
          !isStale(cached.checkedAt, now, staleAfterMs)
        ) {
          return {
            kind: 'result',
            provider: cached.provider,
            status: cached.status,
            source: 'cache',
            checkedAt: cached.checkedAt,
            raw: cached.raw,
          }
        }
      } catch (error) {
        report('cache_read', error)
      }
    }
    if (!(await mayCall())) {
      return { kind: 'skipped', provider: provider.name, reason: 'budget' }
    }
    let answer: VerifierResult
    try {
      answer = await verifyWithin(provider, address, timeoutMs, signal)
      if (!isVerifierStatus(answer.status)) {
        throw new VerifierError('the provider gave an unknown status')
      }
    } catch (error) {
      report('provider', error)
      return {
        kind: 'failed',
        provider: provider.name,
        error: describe(error),
        timedOut: error instanceof VerifierError && error.timedOut,
      }
    }
    const checkedAt = now.toISOString()
    if (options.cache && key !== null) {
      try {
        await options.cache.set(key, {
          provider: provider.name,
          status: answer.status,
          raw: answer.raw,
          checkedAt,
          source: 'api',
        })
      } catch (error) {
        report('cache_write', error)
      }
    }
    return {
      kind: 'result',
      provider: provider.name,
      status: answer.status,
      source: 'call',
      checkedAt,
      raw: answer.raw,
    }
  }

  /**
   * The findings of a verification outcome.
   * @param outcome - What happened
   * @returns Zero or one finding
   */
  function findingsOf(outcome: VerificationOutcome): EmailFinding[] {
    switch (outcome.kind) {
      case 'result': {
        const finding = findingOfStatus(outcome.status, policy)
        return finding ? [finding] : []
      }
      case 'failed':
        return [
          {
            code: 'verifier_failed',
            verdict: policy(null),
            message:
              `the verifier (${outcome.provider}) gave no answer: ` +
              outcome.error,
          },
        ]
      case 'skipped':
        return [
          {
            code: 'verifier_skipped',
            verdict: policy(null),
            message: `the verifier (${outcome.provider}) was skipped: ` +
              'the call budget is used up',
          },
        ]
    }
  }

  return {
    async validate(
      address: string,
      call: ValidateCallOptions = {}
    ): Promise<ValidatorResult> {
      const local = validateEmailAddress(address, {
        ...(options.disposable ? { disposable: options.disposable } : {}),
      })
      const findings = [...local.findings]
      const result = (
        domainCheck: DomainVerdict | null,
        outcome: VerificationOutcome | null
      ): ValidatorResult => ({
        normalized: local.normalized,
        canonical: local.canonical,
        verdict: verdictOfFindings(findings),
        findings,
        domainCheck,
        verification: outcome,
      })
      if (local.verdict === 'reject') {
        return result(null, null)
      }

      let domainCheck: DomainVerdict | null = null
      if (options.dns) {
        const domain = local.normalized.slice(
          local.normalized.lastIndexOf('@') + 1
        )
        try {
          domainCheck = await options.dns(
            domain,
            call.signal ? { signal: call.signal } : {}
          )
        } catch (error) {
          report('dns', error)
          domainCheck = 'ok'
        }
        if (domainCheck === 'undeliverable') {
          findings.push({
            code: 'domain_undeliverable',
            verdict: 'reject',
            message:
              `${domain} cannot receive email: it does not exist or ` +
              'has no mail server',
          })
          return result(domainCheck, null)
        }
      }

      if (!options.provider) {
        return result(domainCheck, null)
      }
      const outcome = await verification(
        options.provider,
        local.normalized,
        call.signal
      )
      findings.push(...findingsOf(outcome))
      return result(domainCheck, outcome)
    },
  }
}
