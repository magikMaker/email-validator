/**
 * The shared types of the validation chain: verdicts, findings, and the
 * plug points the optional entries (`/disposable`, `/dns`) fill in.
 */

import type { VerifierStatus } from './verifier.js'

/**
 * What the chain decides about an address: `send` it, ask a person to
 * `review` it, or `reject` it.
 */
export type EmailVerdict = 'send' | 'review' | 'reject'

/** The machine readable reasons of the chain. */
export type EmailFindingCode =
  /** The address is not well formed; nothing else is checked. */
  | 'syntax_invalid'
  /** A domain reserved for documentation and tests (`example.com`). */
  | 'reserved_domain'
  /** The top level domain is not on the IANA list. */
  | 'tld_unknown'
  /** The domain looks like a typo of a common mail domain. */
  | 'domain_typo_suspected'
  /** The local part cannot exist at its provider. */
  | 'provider_rules_invalid'
  /** The local part is unusual at its provider (iCloud length). */
  | 'provider_rules_review'
  /** The domain is a throwaway mailbox service. */
  | 'disposable_domain'
  /** The local part names a role, not a person. */
  | 'role_account'
  /** DNS says the domain does not exist or takes no mail. */
  | 'domain_undeliverable'
  /** The verifier says the mailbox takes no mail. */
  | 'mailbox_invalid'
  /** The verifier says the mailbox is disposable. */
  | 'mailbox_disposable'
  /** The verifier says the address is a spam trap. */
  | 'mailbox_spamtrap'
  /** The verifier says the address is known for abuse. */
  | 'mailbox_abuse'
  /** The verifier says the domain accepts every address. */
  | 'mailbox_catch_all'
  /** The verifier could not tell. */
  | 'mailbox_unknown'
  /** The verifier says the address is a role address. */
  | 'mailbox_role'
  /** The verifier failed, timed out or was aborted. */
  | 'verifier_failed'
  /** The verifier was not called: the call budget said no. */
  | 'verifier_skipped'

/** One finding of the chain. */
export interface EmailFinding {
  /** The reason, see {@link EmailFindingCode}. */
  code: EmailFindingCode
  /**
   * What this finding asks for: `reject` stops the send, `review` asks a
   * person, `send` is for the record only (a verifier outage under the
   * `gate` policy, for example).
   */
  verdict: EmailVerdict
  /** Why, in plain words. */
  message: string
  /** The mail provider's id (`gmail`), with the `provider_rules_*` codes. */
  provider?: string
  /** The suggested address, with `domain_typo_suspected`. */
  suggestion?: string
  /** The verifier status, with the `mailbox_*` codes. */
  status?: VerifierStatus
}

/** What the chain found about an address. */
export interface EmailValidation {
  /** The address trimmed and lowercased. */
  normalized: string
  /** The canonical key (`canonicalEmailKey`), for de-duplication. */
  canonical: string
  /**
   * `reject` when any finding rejects, else `review` when any asks for
   * it, else `send`.
   */
  verdict: EmailVerdict
  /** Every finding, in chain order. */
  findings: EmailFinding[]
}

/**
 * Whether a domain (or a parent of it) is a throwaway mailbox service.
 * `isDisposableDomain` of the `/disposable` entry is one.
 */
export type DisposableCheck = (domain: string) => boolean

/** What a DNS check says about a domain. */
export type DomainVerdict = 'ok' | 'undeliverable'

/** Options of one {@link DomainCheck} call. */
export interface DomainCheckCallOptions {
  /** Aborts the lookup; an aborted lookup answers `ok` (fail open). */
  signal?: AbortSignal
}

/**
 * Whether a domain can receive mail. `createDomainCheck` of the `/dns`
 * entry makes one. It never throws: a lookup without a clear answer is
 * `ok` (fail open).
 */
export type DomainCheck = (
  domain: string,
  options?: DomainCheckCallOptions
) => Promise<DomainVerdict>
