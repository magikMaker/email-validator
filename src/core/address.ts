/**
 * The shape check of an address (stricter than a regex or Zod's
 * `.email()`) and the typo hint for the common mail domains. Both are
 * pure: no DNS, no network, no state.
 */

import { PROVIDER_DOMAINS, wrongTldSuggestion } from './mail-providers.js'

/**
 * What {@link checkEmailShape} finds wrong with an address: `syntax` is
 * the usual invalid email; `reserved_domain` is a well formed address at
 * a domain that can never receive mail (`example.com`, `.test`, ...).
 */
export type EmailShapeProblem = 'syntax' | 'reserved_domain'

/** Characters of the whole address at most (RFC 5321 path length). */
const MAX_ADDRESS_LENGTH = 254

/** Characters of the local part at most. */
const MAX_LOCAL_LENGTH = 64

/** Characters of the domain at most. */
const MAX_DOMAIN_LENGTH = 253

/**
 * Domains that are reserved for documentation and tests (RFC 2606 and
 * RFC 6761), matched exactly and as a parent (`mail.example.com`).
 */
const RESERVED_DOMAINS = [
  'example.com',
  'example.net',
  'example.org',
  'localhost',
] as const

/** Top level labels that never resolve on the public internet. */
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost', 'local']

/**
 * One domain label: letters (any script), digits and `-`, 1 to 63
 * characters, no `-` at either end.
 */
const LABEL_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u

/** The top level label: 2 or more letters, or a punycode `xn--` label. */
const TLD_PATTERN = /^(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/u

/** The local part: no whitespace, no control characters, no `@`. */
const LOCAL_PATTERN = /^[^\s@\p{C}]+$/u

/**
 * Whether a domain is one of the reserved names or lives under one.
 * @param domain - A lowercased domain
 * @returns True when nothing at this domain can receive mail
 */
function isReservedDomain(domain: string): boolean {
  for (const reserved of RESERVED_DOMAINS) {
    if (domain === reserved || domain.endsWith(`.${reserved}`)) {
      return true
    }
  }
  const tld = domain.slice(domain.lastIndexOf('.') + 1)
  return RESERVED_TLDS.includes(tld)
}

/**
 * Check the shape of an email address, stricter than Zod's `.email()`:
 * exactly one `@`, a local part of 1 to 64 characters, a domain with at
 * least one dot and well formed labels, a top level label of 2 or more
 * letters (or `xn--`), no IP literal. A reserved domain (`example.com`,
 * `example.net`, `example.org`, `localhost`, and anything under `.test`,
 * `.example`, `.invalid`, `.localhost` or `.local`) is reported on its
 * own, so the form can say the domain cannot receive email.
 *
 * The address is trimmed and compared case insensitively; the caller
 * keeps its own normalisation.
 * @param email - The address as typed
 * @returns `'syntax'`, `'reserved_domain'`, or null when the shape is fine
 */
export function checkEmailShape(email: string): EmailShapeProblem | null {
  const value = email.trim().toLowerCase()
  if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) {
    return 'syntax'
  }
  const at = value.indexOf('@')
  if (at < 0 || at !== value.lastIndexOf('@')) {
    return 'syntax'
  }
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (
    local.length === 0 ||
    local.length > MAX_LOCAL_LENGTH ||
    !LOCAL_PATTERN.test(local)
  ) {
    return 'syntax'
  }
  if (domain.length === 0 || domain.length > MAX_DOMAIN_LENGTH) {
    return 'syntax'
  }
  if (isReservedDomain(domain)) {
    return 'reserved_domain'
  }
  const labels = domain.split('.')
  if (labels.length < 2) {
    return 'syntax'
  }
  for (const label of labels) {
    if (!LABEL_PATTERN.test(label)) {
      return 'syntax'
    }
  }
  const tld = labels[labels.length - 1] ?? ''
  if (!TLD_PATTERN.test(tld)) {
    return 'syntax'
  }
  return null
}

/**
 * The mail domains people use most, in that order. A tie between two
 * suggestions goes to the earlier entry. `outlook.nl` is not on it, since
 * Microsoft has no such domain.
 */
const FREQUENT_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yahoo.com',
  'aol.com',
  'mail.com',
  'proton.me',
  'protonmail.com',
  'gmx.de',
  'gmx.net',
  'gmx.com',
  'web.de',
  't-online.de',
  'ziggo.nl',
  'kpnmail.nl',
  'hetnet.nl',
  'planet.nl',
  'home.nl',
  'xs4all.nl',
  'live.nl',
  'hotmail.nl',
  'telenet.be',
  'skynet.be',
  'orange.fr',
  'free.fr',
  'laposte.net',
  'wanadoo.fr',
  'sfr.fr',
  'libero.it',
  'bluewin.ch',
  'yahoo.co.uk',
  'hotmail.co.uk',
  'btinternet.com',
  'fastmail.com',
  'hey.com',
  'zoho.com',
  'yandex.ru',
  'mail.ru',
]

/**
 * The mail domains the typo hint knows: the frequent ones first, in the
 * agreed order, then every other domain of the provider table
 * (`data/email-providers.json`), so a near miss of any known provider
 * domain gets a hint and no real provider domain is ever flagged.
 */
export const COMMON_EMAIL_DOMAINS: readonly string[] = [
  ...FREQUENT_EMAIL_DOMAINS,
  ...PROVIDER_DOMAINS.filter(
    (domain) => !FREQUENT_EMAIL_DOMAINS.includes(domain)
  ),
]

/**
 * A distance of 2 is only suggested when both domains are at least this
 * long, so short real domains (`gmx.at`, `live.de`) get no hint.
 */
const LONG_DOMAIN_LENGTH = 8

/**
 * The optimal string alignment distance: Levenshtein (insert, delete,
 * substitute) plus the swap of two neighbouring characters, each costing
 * one. `gmial` is one step from `gmail`.
 * @param a - One string
 * @param b - The other
 * @returns The number of edits
 */
export function editDistance(a: string, b: string): number {
  const cols = b.length + 1
  /**
   * A cell of a finished row; every index read here was written.
   * @param row - The row
   * @param j - The column
   * @returns The cell
   */
  const at = (row: number[], j: number): number => row[j] ?? 0
  // Three rows are enough: the swap looks two rows back.
  let twoBack: number[] = new Array<number>(cols).fill(0)
  let previous: number[] = Array.from({ length: cols }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = new Array<number>(cols).fill(0)
    current[0] = i
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(
        at(previous, j) + 1,
        at(current, j - 1) + 1,
        at(previous, j - 1) + cost
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(twoBack, j - 2) + 1)
      }
      current[j] = best
    }
    twoBack = previous
    previous = current
  }
  return at(previous, b.length)
}

/**
 * The part after the last dot.
 * @param domain - A lowercased domain
 * @returns The top level label
 */
function tldOf(domain: string): string {
  return domain.slice(domain.lastIndexOf('.') + 1)
}

/**
 * Suggest a correction for a typo in the domain of an address, against
 * {@link COMMON_EMAIL_DOMAINS}. It only suggests; it never blocks or
 * changes anything by itself.
 *
 * The domain is the part after the last `@`, lowercased. There is no hint
 * when it is empty, has no dot, or is itself on the list. A known
 * provider name on a TLD the provider does not use (`gmail.de`,
 * `proton.com`, `hotmail.xyz`) is suggested as the provider's domain
 * (`wrongTldSuggestion`). Otherwise the closest listed domain (by
 * {@link editDistance}, ties to the earlier entry) is suggested when the
 * distance is 1, or 2 when the typed domain and the suggestion both have
 * 8 or more characters and share the top level label; real domains like
 * `yahoo.de` or `acme.com` get no hint.
 * @param email - The address as typed
 * @returns The full suggested address (the local part as typed, `@`, the
 *   suggested domain), ready for "Did you mean name@gmail.com?", or null
 */
export function suggestEmailDomain(email: string): string | null {
  const value = email.trim()
  const at = value.lastIndexOf('@')
  if (at < 0) {
    return null
  }
  const local = value.slice(0, at)
  const domain = value.slice(at + 1).toLowerCase()
  if (
    domain.length === 0 ||
    !domain.includes('.') ||
    COMMON_EMAIL_DOMAINS.includes(domain)
  ) {
    return null
  }
  const wrongTld = wrongTldSuggestion(domain)
  if (wrongTld !== null) {
    return `${local}@${wrongTld}`
  }
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const distance = editDistance(domain, candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  if (best === null) {
    return null
  }
  const close =
    bestDistance === 1 ||
    (bestDistance === 2 &&
      domain.length >= LONG_DOMAIN_LENGTH &&
      best.length >= LONG_DOMAIN_LENGTH &&
      tldOf(domain) === tldOf(best))
  return close ? `${local}@${best}` : null
}

