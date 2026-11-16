/**
 * Policies: how a verifier status turns into a verdict. A policy also
 * decides what an absent answer means (`null`: the provider failed,
 * timed out, was aborted or skipped). Two built-in ones match the two
 * usages the library came from; a custom function fits anything else.
 */

import type { EmailVerdict } from './types.js'
import type { VerifierStatus } from './verifier.js'

/**
 * A policy: the verdict of a status, or of no answer at all (`null`).
 */
export type VerifierPolicy = (status: VerifierStatus | null) => EmailVerdict

/** The names of the built-in policies. */
export type PolicyName = 'gate' | 'review'

/**
 * The request gate (a signup, a forward, a public form): refuse only an
 * address that cannot take mail (`invalid`, `disposable`, and `spamtrap`
 * or `abuse` should a provider return them). `valid`, `catch_all`,
 * `unknown` and `role` send, and so does no answer: the gate fails open,
 * so an outage at the provider never blocks a person.
 * @param status - The status, or null when there is no answer
 * @returns The verdict
 */
export const gatePolicy: VerifierPolicy = (status) => {
  switch (status) {
    case 'invalid':
    case 'disposable':
    case 'spamtrap':
    case 'abuse':
      return 'reject'
    default:
      return 'send'
  }
}

/**
 * The onboarding review (an admin looks at a list): `valid` sends;
 * `invalid`, `disposable`, `spamtrap` and `abuse` reject; `catch_all`,
 * `unknown` and `role` go to review, and so does no answer, since nobody
 * vouched for the mailbox.
 * @param status - The status, or null when there is no answer
 * @returns The verdict
 */
export const reviewPolicy: VerifierPolicy = (status) => {
  switch (status) {
    case 'valid':
      return 'send'
    case 'invalid':
    case 'disposable':
    case 'spamtrap':
    case 'abuse':
      return 'reject'
    default:
      return 'review'
  }
}

/**
 * The policy function of a name or a function.
 * @param policy - `gate`, `review`, a function, or undefined for `gate`
 * @returns The function
 */
export function policyOf(
  policy: PolicyName | VerifierPolicy | undefined
): VerifierPolicy {
  if (typeof policy === 'function') {
    return policy
  }
  return policy === 'review' ? reviewPolicy : gatePolicy
}
