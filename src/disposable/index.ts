/**
 * `@magikmaker/email-validator/disposable`: the disposable (throwaway)
 * domain list and its checks. It is its own entry because the list is
 * about 10,000 domains; the core never imports it, so a browser bundle
 * that only shows field hints stays small. Plug it into the core with
 * the `disposable` option:
 *
 * ```ts
 * validateEmailAddress(address, { disposable: isDisposableDomain })
 * ```
 *
 * The list is `data/disposable-domains.ts`, regenerated weekly by
 * `scripts/update-disposable-domains.mjs` from the CC0 community list
 * disposable-email-domains, minus `lists/disposable-allowlist.txt` and
 * the provider table.
 */

import { DISPOSABLE_DOMAIN_LIST } from '../data/disposable-domains.js'
import { splitEmail } from '../core/canonical.js'
import type { DisposableCheck } from '../core/types.js'

/** The disposable domains, lowercase. */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set(
  DISPOSABLE_DOMAIN_LIST.split('\n').filter((line) => line.length > 0)
)

/**
 * Whether a domain, or a parent of it, is in a set. `mail.yopmail.com`
 * is in it when `yopmail.com` is.
 * @param set - The domains
 * @param domain - A lowercased domain
 * @returns True when the domain or a parent is in the set
 */
function inSet(set: ReadonlySet<string>, domain: string): boolean {
  const labels = domain.split('.')
  for (let i = 0; i < labels.length - 1; i++) {
    if (set.has(labels.slice(i).join('.'))) {
      return true
    }
  }
  return false
}

/**
 * Whether a domain, or a parent of it, is on the disposable list.
 * `mail.yopmail.com` is as disposable as `yopmail.com`.
 * @param domain - A domain, any case
 * @returns True for a throwaway mailbox service
 */
export function isDisposableDomain(domain: string): boolean {
  return inSet(DISPOSABLE_DOMAINS, domain.trim().toLowerCase())
}

/**
 * Whether the domain of an address is disposable. See
 * {@link isDisposableDomain}.
 * @param email - The address as typed
 * @returns True for a throwaway mailbox service
 */
export function isDisposableEmail(email: string): boolean {
  const parts = splitEmail(email)
  return parts !== null && isDisposableDomain(parts.domain)
}

/** Options of {@link createDisposableCheck}. */
export interface DisposableCheckOptions {
  /**
   * Domains that are never disposable, whatever the list says (your own
   * false positives). A listed domain also allows its subdomains.
   */
  allow?: readonly string[]
  /** Domains that are disposable on top of the list. */
  block?: readonly string[]
}

/**
 * A disposable check with your own additions: `allow` always wins, then
 * `block`, then the bundled list.
 * @param options - See {@link DisposableCheckOptions}
 * @returns The check, ready for the core's `disposable` option
 */
export function createDisposableCheck(
  options: DisposableCheckOptions = {}
): DisposableCheck {
  const normalize = (list: readonly string[] = []): Set<string> =>
    new Set(list.map((d) => d.trim().toLowerCase()).filter(Boolean))
  const allow = normalize(options.allow)
  const block = normalize(options.block)
  return (domain: string): boolean => {
    const lower = domain.trim().toLowerCase()
    if (inSet(allow, lower)) {
      return false
    }
    return inSet(block, lower) || inSet(DISPOSABLE_DOMAINS, lower)
  }
}
