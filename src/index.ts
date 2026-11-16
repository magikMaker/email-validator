/**
 * `@magikmaker/email-validator`: the core entry. Small and browser safe:
 * the shape check, the TLD check, the mail provider rules, the typo hint,
 * role accounts, the local validation chain and the validator with its
 * pluggable verification provider. The disposable list, the DNS check and
 * the providers live in their own entries, so a browser bundle only pays
 * for what it imports.
 */

export {
  COMMON_EMAIL_DOMAINS,
  checkEmailShape,
  editDistance,
  suggestEmailDomain,
} from './core/address.js'
export type { EmailShapeProblem } from './core/address.js'

export {
  ROLE_ACCOUNT_NAMES,
  canonicalEmailKey,
  checkProviderRules,
  isKnownTld,
  isRoleAccount,
  splitEmail,
  stripPlusTag,
  toAsciiDomain,
} from './core/canonical.js'
export type { ProviderRuleProblem } from './core/canonical.js'

export {
  EMAIL_PROVIDERS,
  PROVIDER_DOMAINS,
  providerOfDomain,
  providerOfEmail,
  wrongTldSuggestion,
} from './core/mail-providers.js'
export type {
  EmailProvider,
  ProviderCanonicalRule,
  ProviderRuleSet,
} from './core/mail-providers.js'

export { IANA_TLDS, hasValidTld } from './core/tld.js'

export {
  EMAIL_REFUSAL_MESSAGES,
  EMAIL_REFUSAL_REASONS,
  checkTypedEmail,
  findingReasonCode,
  likelyTypoMessage,
  validateEmailAddress,
  verdictOfFindings,
} from './core/validate.js'
export type {
  CheckTypedEmailOptions,
  EmailRefusalReason,
  TypedEmailProblem,
  ValidateEmailOptions,
} from './core/validate.js'

export type {
  DisposableCheck,
  DomainCheck,
  DomainCheckCallOptions,
  DomainVerdict,
  EmailFinding,
  EmailFindingCode,
  EmailValidation,
  EmailVerdict,
} from './core/types.js'

export {
  VERIFIER_STATUSES,
  VerifierError,
  isVerifierStatus,
} from './core/verifier.js'
export type {
  VerifierErrorOptions,
  VerifierProvider,
  VerifierResult,
  VerifierStatus,
  VerifyOptions,
} from './core/verifier.js'

export { gatePolicy, policyOf, reviewPolicy } from './core/policy.js'
export type { PolicyName, VerifierPolicy } from './core/policy.js'

export {
  DEFAULT_STALE_AFTER_MS,
  createMemoryCache,
  isStale,
} from './core/cache.js'
export type {
  CachedResult,
  MemoryCache,
  MemoryCacheOptions,
  VerifierCache,
} from './core/cache.js'

export { emailHash, sha256Hex, toHex } from './core/hash.js'

export {
  DEFAULT_VERIFY_TIMEOUT_MS,
  createValidator,
  findingOfStatus,
} from './core/validator.js'
export type {
  ValidateCallOptions,
  ValidatorOptions,
  ValidatorResult,
  ValidatorStage,
  Validator,
  VerificationOutcome,
} from './core/validator.js'
