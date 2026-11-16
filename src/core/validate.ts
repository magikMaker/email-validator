/**
 * The local validation chain of an address: normalise, generic syntax,
 * reserved domain, TLD, typo, provider rules, disposable domain (when a
 * list is plugged in), role account. Two readers:
 * - {@link validateEmailAddress}: every finding at once with a verdict
 *   (`send`, `review`, `reject`), for signups, onboarding checks and bulk
 *   runs, where all reasons matter;
 * - {@link checkTypedEmail}: the first refusal of a typed address, in the
 *   shape a form field shows, with the typo hint the person may confirm
 *   away.
 *
 * Pure, Workers and browser compatible, no I/O. DNS and verification
 * are `createValidator`'s business.
 */

import { checkEmailShape, suggestEmailDomain } from './address.js'
import {
  canonicalEmailKey,
  checkProviderRules,
  isKnownTld,
  isRoleAccount,
  splitEmail,
} from './canonical.js'
import type {
  DisposableCheck,
  EmailFinding,
  EmailValidation,
  EmailVerdict,
} from './types.js'

/**
 * Why a form refuses a typed address:
 * - `invalid_email`: the shape is wrong;
 * - `likely_typo`: the domain is one or two letters off a common mail
 *   domain; the problem carries a `suggestion`, and the person may keep
 *   the address (`confirmTypo`);
 * - `undeliverable_domain`: the domain is reserved, has a TLD IANA does
 *   not publish, does not exist or has no mail server;
 * - `provider_rules`: the local part breaks its provider's rules, so the
 *   address cannot exist;
 * - `disposable_domain`: the domain is a throwaway mailbox service;
 * - `undeliverable_mailbox`: a verifier says the mailbox takes no mail.
 */
export const EMAIL_REFUSAL_REASONS = [
  'invalid_email',
  'likely_typo',
  'undeliverable_domain',
  'provider_rules',
  'disposable_domain',
  'undeliverable_mailbox',
] as const

/** One of {@link EMAIL_REFUSAL_REASONS}. */
export type EmailRefusalReason = (typeof EMAIL_REFUSAL_REASONS)[number]

/**
 * The text of each refusal reason, for a person. The `likely_typo` text
 * is the fallback; {@link likelyTypoMessage} names the suggestion.
 */
export const EMAIL_REFUSAL_MESSAGES: Readonly<
  Record<EmailRefusalReason, string>
> = {
  invalid_email: 'Please enter a valid email address.',
  likely_typo:
    'This address looks like it has a typo. Check it, or send it ' +
    'again to keep it as it is.',
  undeliverable_domain:
    'This email domain cannot receive email. Check the address for typos.',
  provider_rules:
    'This address cannot exist at its email provider. Check it for typos.',
  disposable_domain:
    'Temporary or disposable email addresses cannot be used. ' +
    'Please use an address you keep.',
  undeliverable_mailbox:
    'This address cannot receive email. Check it for typos, or use ' +
    'another address.',
}

/**
 * The text of a `likely_typo` refusal and of a `domain_typo_suspected`
 * finding.
 * @param suggestion - The suggested address
 * @returns "Did you mean name@gmail.com?"
 */
export function likelyTypoMessage(suggestion: string): string {
  return `Did you mean ${suggestion}?`
}

/** What {@link checkTypedEmail} finds wrong with an address. */
export interface TypedEmailProblem {
  /** Why; `undeliverable_mailbox` needs a verifier, so never here. */
  reason: Exclude<EmailRefusalReason, 'undeliverable_mailbox'>
  /** The text to show on the field. */
  message: string
  /** The suggested address; only with `likely_typo`. */
  suggestion?: string
  /** The mail provider's id; only with `provider_rules`. */
  provider?: string
}

/** Options of {@link checkTypedEmail}. */
export interface CheckTypedEmailOptions {
  /**
   * The person saw the typo hint and keeps the address as typed: no
   * `likely_typo` problem is reported.
   */
  confirmTypo?: boolean
  /** The disposable domain check; none when unset. */
  disposable?: DisposableCheck
}

/**
 * The checks of a typed address, in the order a form runs them: the
 * shape (a reserved domain is `undeliverable_domain`), the TLD against
 * the IANA list (an unknown one is `undeliverable_domain`), the typo hint
 * unless `confirmTypo` is set, the local part rules of the provider
 * (`provider_rules`), then the disposable check when one is plugged in.
 * The typo hint runs before the provider rules, so `anna@gmail.de` gets
 * "Did you mean anna@gmail.com?" rather than a refusal. Confirming a typo
 * never confirms away the rules or a disposable domain.
 * @param email - The address as typed
 * @param options - See {@link CheckTypedEmailOptions}
 * @returns The first problem, or null when the address may go on
 */
export function checkTypedEmail(
  email: string,
  options: CheckTypedEmailOptions = {}
): TypedEmailProblem | null {
  const shape = checkEmailShape(email)
  if (shape === 'syntax') {
    return {
      reason: 'invalid_email',
      message: EMAIL_REFUSAL_MESSAGES.invalid_email,
    }
  }
  const domain = email.trim().slice(email.trim().lastIndexOf('@') + 1)
  if (shape === 'reserved_domain' || !isKnownTld(domain)) {
    return {
      reason: 'undeliverable_domain',
      message: EMAIL_REFUSAL_MESSAGES.undeliverable_domain,
    }
  }
  if (!options.confirmTypo) {
    const suggestion = suggestEmailDomain(email)
    if (suggestion !== null) {
      return {
        reason: 'likely_typo',
        message: likelyTypoMessage(suggestion),
        suggestion,
      }
    }
  }
  const rules = checkProviderRules(email)
  if (rules?.verdict === 'reject') {
    return {
      reason: 'provider_rules',
      message: rules.message,
      provider: rules.provider,
    }
  }
  if (options.disposable?.(domain.toLowerCase())) {
    return {
      reason: 'disposable_domain',
      message: EMAIL_REFUSAL_MESSAGES.disposable_domain,
    }
  }
  return null
}

/**
 * The verdict of a set of findings: `reject` when any rejects, else
 * `review` when any asks for it, else `send`.
 * @param findings - The findings
 * @returns The verdict
 */
export function verdictOfFindings(
  findings: readonly EmailFinding[]
): EmailVerdict {
  if (findings.some((f) => f.verdict === 'reject')) {
    return 'reject'
  }
  return findings.some((f) => f.verdict === 'review') ? 'review' : 'send'
}

/**
 * The reason code of a finding with its provider, when there is one:
 * `provider_rules_invalid:gmail`, `domain_typo_suspected`, ...
 * @param finding - A finding
 * @returns The code
 */
export function findingReasonCode(finding: EmailFinding): string {
  return finding.provider
    ? `${finding.code}:${finding.provider}`
    : finding.code
}

/** Options of {@link validateEmailAddress}. */
export interface ValidateEmailOptions {
  /**
   * The disposable domain check, e.g. `isDisposableDomain` of the
   * `/disposable` entry. Without it no address is found disposable,
   * which keeps the list out of browser bundles.
   */
  disposable?: DisposableCheck
}

/**
 * Run the local chain and report every finding. The generic syntax check
 * stops the chain (nothing else can be said about a malformed address);
 * every other step runs, so all reasons show at once.
 * @param email - The address as typed
 * @param options - See {@link ValidateEmailOptions}
 * @returns The verdict, the keys and the findings
 */
export function validateEmailAddress(
  email: string,
  options: ValidateEmailOptions = {}
): EmailValidation {
  const normalized = email.trim().toLowerCase()
  const canonical = canonicalEmailKey(email)
  const findings: EmailFinding[] = []
  const result = (): EmailValidation => ({
    normalized,
    canonical,
    verdict: verdictOfFindings(findings),
    findings,
  })

  const shape = checkEmailShape(email)
  if (shape === 'syntax') {
    findings.push({
      code: 'syntax_invalid',
      verdict: 'reject',
      message: EMAIL_REFUSAL_MESSAGES.invalid_email,
    })
    return result()
  }
  const domain = splitEmail(email)?.domain ?? ''
  if (shape === 'reserved_domain') {
    findings.push({
      code: 'reserved_domain',
      verdict: 'reject',
      message:
        `${domain} is reserved for documentation and tests and can ` +
        'never receive email',
    })
  } else if (!isKnownTld(domain)) {
    findings.push({
      code: 'tld_unknown',
      verdict: 'reject',
      message: `the top level domain of ${domain} does not exist`,
    })
  }

  const suggestion = suggestEmailDomain(email)
  if (suggestion !== null) {
    findings.push({
      code: 'domain_typo_suspected',
      verdict: 'review',
      message: likelyTypoMessage(suggestion),
      suggestion,
    })
  }

  const rules = checkProviderRules(email)
  if (rules) {
    findings.push({
      code:
        rules.verdict === 'reject'
          ? 'provider_rules_invalid'
          : 'provider_rules_review',
      verdict: rules.verdict,
      message: rules.message,
      provider: rules.provider,
    })
  }

  if (options.disposable?.(domain)) {
    findings.push({
      code: 'disposable_domain',
      verdict: 'reject',
      message: `${domain} is a known disposable email provider`,
    })
  }

  if (isRoleAccount(email)) {
    findings.push({
      code: 'role_account',
      verdict: 'review',
      message:
        'the local part names a role (info, admin, no-reply, ...), ' +
        'not a person',
    })
  }

  return result()
}
