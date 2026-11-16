/**
 * The mail provider table (`data/email-providers.json`): which domains
 * belong to which provider, how a provider reduces a local part for
 * de-duplication, which local part rules it publishes, and which names
 * only exist at its domains (so `gmail.de` is a suspected typo of
 * `gmail.com`). Pure lookups, no I/O; the table is data, so a provider
 * or a domain is added in the JSON file, not here.
 */

import providersJson from '../data/email-providers.json'

/** How a provider reduces a local part to one key per mailbox. */
export type ProviderCanonicalRule =
  /** Dots removed, plus tag stripped, alias domains fold into the primary. */
  | 'gmail'
  /** Dots, hyphens and underscores removed, plus tag stripped. */
  | 'proton'
  /** Plus tag stripped; everything else is significant. */
  | 'plus'
  /** As typed: the provider has no plus addressing. */
  | 'none'

/** The published local part rules a provider is checked against. */
export type ProviderRuleSet =
  | 'gmail'
  | 'microsoft'
  | 'proton'
  | 'tuta'
  | 'icloud'
  | 'generic'

/** One provider of the table. */
export interface EmailProvider {
  /** A short stable id, e.g. `gmail`, used in reason codes. */
  id: string
  /** The name people know, e.g. `Gmail`. */
  name: string
  /** The domain its alias domains and typos point to. */
  primaryDomain: string
  /** Every address domain of the provider, lowercase. */
  domains: readonly string[]
  /** How a local part is reduced for {@link canonicalEmailKey}. */
  canonical: ProviderCanonicalRule
  /** Which local part rules {@link checkProviderRules} applies. */
  rules: ProviderRuleSet
  /**
   * Names that only exist at the listed domains: the same first label on
   * a TLD that is not in `domains` is a suspected typo.
   */
  typoNames: readonly string[]
}

/** The shape of the JSON file. */
interface ProvidersFile {
  /** Every provider, in file order. */
  providers: EmailProvider[]
}

/** Every provider, in file order. */
export const EMAIL_PROVIDERS: readonly EmailProvider[] = (
  providersJson as ProvidersFile
).providers

/** Provider by lowercase domain. */
const BY_DOMAIN: ReadonlyMap<string, EmailProvider> = new Map(
  EMAIL_PROVIDERS.flatMap((provider) =>
    provider.domains.map((domain): [string, EmailProvider] => [
      domain,
      provider,
    ])
  )
)

/** Provider by typo name (its first label). */
const BY_TYPO_NAME: ReadonlyMap<string, EmailProvider> = new Map(
  EMAIL_PROVIDERS.flatMap((provider) =>
    provider.typoNames.map((name): [string, EmailProvider] => [
      name,
      provider,
    ])
  )
)

/** Every domain of the table, lowercase, in file order, no duplicates. */
export const PROVIDER_DOMAINS: readonly string[] = [...BY_DOMAIN.keys()]

/**
 * The provider a domain belongs to.
 * @param domain - A domain, any case, surrounding whitespace allowed
 * @returns The provider, or null when the domain is not in the table
 */
export function providerOfDomain(domain: string): EmailProvider | null {
  return BY_DOMAIN.get(domain.trim().toLowerCase()) ?? null
}

/**
 * The provider of an address, by the domain after its last `@`.
 * @param email - The address
 * @returns The provider, or null
 */
export function providerOfEmail(email: string): EmailProvider | null {
  const at = email.lastIndexOf('@')
  return at < 0 ? null : providerOfDomain(email.slice(at + 1))
}

/**
 * The domain a known provider name on the wrong TLD most likely meant:
 * `gmail.de` is `gmail.com`, `proton.com` is `proton.me`, `hotmail.xyz`
 * is `hotmail.com`. A domain that is in the table is never a typo.
 * @param domain - A domain, any case
 * @returns The suggested domain, or null when the name is not a known
 *   provider name or the domain is a real one
 */
export function wrongTldSuggestion(domain: string): string | null {
  const lower = domain.trim().toLowerCase()
  if (BY_DOMAIN.has(lower)) {
    return null
  }
  const dot = lower.indexOf('.')
  if (dot <= 0) {
    return null
  }
  const name = lower.slice(0, dot)
  const provider = BY_TYPO_NAME.get(name)
  if (!provider) {
    return null
  }
  // The provider's own domain with that name, e.g. `hotmail.com` for a
  // `hotmail.*` typo, else its primary domain.
  return (
    provider.domains.find((candidate) => candidate.startsWith(`${name}.`)) ??
    provider.primaryDomain
  )
}
