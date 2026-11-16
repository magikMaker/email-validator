/**
 * The provider aware checks of an address that need no big data: the
 * canonical key (one key per mailbox, for de-duplication and hashes), the
 * local part rules the providers publish, the role account names, and
 * the TLD check against the IANA list. All pure, Workers and browser
 * compatible, no I/O. The provider table is `mail-providers.ts`.
 */

import { providerOfDomain } from './mail-providers.js'
import type { EmailProvider, ProviderRuleSet } from './mail-providers.js'
import { hasValidTld } from './tld.js'

/**
 * Split an address at its last `@`, trimmed and lowercased.
 * @param email - The address as typed
 * @returns The local part and the domain, or null when there is no `@`
 */
export function splitEmail(
  email: string
): { local: string; domain: string } | null {
  const value = email.trim().toLowerCase()
  const at = value.lastIndexOf('@')
  if (at < 0) {
    return null
  }
  return { local: value.slice(0, at), domain: value.slice(at + 1) }
}

/**
 * The local part without its plus tag (`anna+promo` is `anna`).
 * @param local - A local part
 * @returns The part before the first `+`
 */
export function stripPlusTag(local: string): string {
  const plus = local.indexOf('+')
  return plus < 0 ? local : local.slice(0, plus)
}

/**
 * The canonical key of an address: the one string every variant of a
 * mailbox reduces to, for de-duplication. Per provider (see
 * `data/email-providers.json`):
 * - Gmail: dots removed, plus tag stripped, `googlemail.com` folds into
 *   `gmail.com`;
 * - Proton: dots, hyphens and underscores removed, plus tag stripped; no
 *   merge across Proton domains;
 * - Tuta: as typed (no plus addressing there);
 * - Microsoft, iCloud and every other domain: plus tag stripped only,
 *   dots are significant.
 * The whole address is trimmed and lowercased. An IDN domain is kept as
 * typed (lowercased), like the exact hash does.
 * @param email - The address as typed
 * @returns The key, e.g. `annalund@gmail.com` for `Anna.Lund+x@googlemail.com`
 */
export function canonicalEmailKey(email: string): string {
  const parts = splitEmail(email)
  if (!parts) {
    return email.trim().toLowerCase()
  }
  const provider = providerOfDomain(parts.domain)
  const rule = provider?.canonical ?? 'plus'
  if (rule === 'none') {
    return `${parts.local}@${parts.domain}`
  }
  let local = stripPlusTag(parts.local)
  let domain = parts.domain
  if (rule === 'gmail') {
    local = local.replace(/\./g, '')
    domain = provider?.primaryDomain ?? domain
  } else if (rule === 'proton') {
    local = local.replace(/[._-]/g, '')
  }
  return `${local}@${domain}`
}

/** What a provider rule found. */
export interface ProviderRuleProblem {
  /** The provider's id, e.g. `gmail`. */
  provider: string
  /**
   * `reject` when the address cannot exist at the provider; `review`
   * when it is unusual but may be an older address (iCloud length).
   */
  verdict: 'reject' | 'review'
  /** Why, in plain words, for a field error or a person. */
  message: string
}

/** Gmail usernames: 6 to 30 letters and digits once the dots are out. */
const GMAIL_COMPACT_PATTERN = /^[a-z0-9]{6,30}$/

/** Microsoft: starts with a letter, then letters, digits, `.`, `_`, `-`. */
const MICROSOFT_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/

/** Proton: letters, digits, `.`, `_`, `-`. */
const PROTON_PATTERN = /^[a-z0-9._-]+$/

/** iCloud aliases are 3 to 20 characters. */
const ICLOUD_LENGTH = { min: 3, max: 20 } as const

/**
 * Whether a local part starts or ends with a dot or has two in a row.
 * @param local - A local part
 * @returns True when the dots are wrong
 */
function hasBadDots(local: string): boolean {
  return local.startsWith('.') || local.endsWith('.') || local.includes('..')
}

/** The text of each rule set's rejection, by provider name. */
const RULE_MESSAGES: Readonly<Record<ProviderRuleSet, string>> = {
  gmail:
    'Gmail addresses have 6 to 30 letters and digits, with no symbols ' +
    'other than dots, so this address cannot exist. Check it for typos.',
  microsoft:
    'Outlook and Hotmail addresses start with a letter and use only ' +
    'letters, digits, dots, underscores and hyphens, so this address ' +
    'cannot exist. Check it for typos.',
  proton:
    'Proton addresses use only letters, digits, dots, underscores and ' +
    'hyphens, so this address cannot exist. Check it for typos.',
  tuta:
    'Tuta addresses have no plus tags, so this address cannot exist. ' +
    'Check it for typos.',
  icloud:
    'iCloud addresses have 3 to 20 characters; this one may be an older ' +
    'me.com or mac.com address.',
  generic: '',
}

/**
 * Check a local part against the rules its provider publishes. The plus
 * tag is removed first, except at Tuta, where a plus tag is the problem.
 * @param local - The lowercased local part
 * @param provider - The provider of the domain
 * @returns The problem, or null when the rules allow the local part
 */
function checkLocalPartRules(
  local: string,
  provider: EmailProvider
): ProviderRuleProblem | null {
  const reject = (): ProviderRuleProblem => ({
    provider: provider.id,
    verdict: 'reject',
    message: RULE_MESSAGES[provider.rules],
  })
  switch (provider.rules) {
    case 'gmail': {
      const bare = stripPlusTag(local)
      if (
        hasBadDots(bare) ||
        !GMAIL_COMPACT_PATTERN.test(bare.replace(/\./g, ''))
      ) {
        return reject()
      }
      return null
    }
    case 'microsoft': {
      const bare = stripPlusTag(local)
      if (hasBadDots(bare) || !MICROSOFT_PATTERN.test(bare)) {
        return reject()
      }
      return null
    }
    case 'proton': {
      const bare = stripPlusTag(local)
      if (hasBadDots(bare) || !PROTON_PATTERN.test(bare)) {
        return reject()
      }
      return null
    }
    case 'tuta':
      return local.includes('+') ? reject() : null
    case 'icloud': {
      const bare = stripPlusTag(local)
      if (
        bare.length < ICLOUD_LENGTH.min ||
        bare.length > ICLOUD_LENGTH.max
      ) {
        return {
          provider: provider.id,
          verdict: 'review',
          message: RULE_MESSAGES.icloud,
        }
      }
      return null
    }
    case 'generic':
      return null
  }
}

/**
 * Check an address against the local part rules of its provider: Gmail
 * (6 to 30 letters and digits, dots not at the ends or doubled),
 * Microsoft (a letter first, then letters, digits, `.`, `_`, `-`), Proton
 * (letters, digits, `.`, `_`, `-`), Tuta (no `+`), iCloud (3 to 20
 * characters, a `review`, never a reject). Other domains have no rules
 * beyond the generic shape.
 * @param email - The address as typed
 * @returns The problem, or null when there is none
 */
export function checkProviderRules(
  email: string
): ProviderRuleProblem | null {
  const parts = splitEmail(email)
  if (!parts) {
    return null
  }
  const provider = providerOfDomain(parts.domain)
  return provider ? checkLocalPartRules(parts.local, provider) : null
}

/**
 * The local parts that name a role, not a person. Mail to them reaches a
 * shared inbox or nobody. Whether that matters is the caller's call: a
 * signup may review it, a contact form may well accept a company's
 * `info@`.
 */
export const ROLE_ACCOUNT_NAMES: readonly string[] = [
  'admin',
  'administrator',
  'info',
  'support',
  'help',
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'postmaster',
  'abuse',
  'webmaster',
  'hostmaster',
  'sales',
  'contact',
  'billing',
  'security',
  'marketing',
  'office',
  'mail',
  'root',
]

const ROLE_ACCOUNT_SET: ReadonlySet<string> = new Set(ROLE_ACCOUNT_NAMES)

/**
 * Whether the local part (without its plus tag) names a role account.
 * @param email - The address as typed
 * @returns True for `info@`, `no-reply@`, `postmaster@` and the like
 */
export function isRoleAccount(email: string): boolean {
  const parts = splitEmail(email)
  if (!parts) {
    return false
  }
  return ROLE_ACCOUNT_SET.has(stripPlusTag(parts.local))
}

/**
 * The ASCII (punycode) form of a domain, as the URL parser gives it: IDN
 * labels become `xn--` labels, a trailing dot goes, case is lowered.
 * @param domain - The domain as typed
 * @returns The ASCII domain, or null when it is not a valid host name
 */
export function toAsciiDomain(domain: string): string | null {
  const trimmed = domain.trim().toLowerCase().replace(/\.$/, '')
  if (!trimmed || /[\s/?#@:\\[\]]/.test(trimmed)) {
    return null
  }
  try {
    const host = new URL(`http://${trimmed}`).hostname
    return host || null
  } catch {
    return null
  }
}

/**
 * Whether the top level label of a domain is one IANA publishes. An IDN
 * domain (`пример.рф`) is converted to punycode first, so its TLD
 * (`xn--p1ai`) is found on the list. A bare label has no TLD.
 * @param domain - The domain as typed
 * @returns True when the TLD exists in the DNS root zone
 */
export function isKnownTld(domain: string): boolean {
  const ascii = toAsciiDomain(domain)
  return ascii !== null && hasValidTld(ascii)
}
