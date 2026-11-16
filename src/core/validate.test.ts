import { describe, expect, it } from 'vitest'
import { isDisposableDomain } from '../disposable'
import {
  EMAIL_REFUSAL_MESSAGES,
  EMAIL_REFUSAL_REASONS,
  checkTypedEmail,
  findingReasonCode,
  likelyTypoMessage,
  validateEmailAddress,
  verdictOfFindings,
} from './validate'
import type { ValidateEmailOptions } from './validate'

/** The chain with the disposable list plugged in. */
const withList: ValidateEmailOptions = { disposable: isDisposableDomain }

describe('checkTypedEmail', () => {
  it('passes an ordinary address', () => {
    expect(checkTypedEmail('anna.lund@gmail.com')).toBeNull()
    expect(checkTypedEmail('anna@acme.com')).toBeNull()
    expect(checkTypedEmail('anna@acme.co.uk')).toBeNull()
  })

  it('reports an unknown TLD as undeliverable_domain, IDN via punycode', () => {
    expect(checkTypedEmail('user@example.notatld')?.reason).toBe(
      'undeliverable_domain'
    )
    expect(checkTypedEmail('user@acme.nonsense', { confirmTypo: true })?.reason)
      .toBe('undeliverable_domain')
    // `.рф` is `xn--p1ai` on the IANA list
    expect(checkTypedEmail('user@пример.рф')).toBeNull()
    expect(checkTypedEmail('user@xn--80ahbyjlf.xn--p1ai')).toBeNull()
  })

  it('reports a known provider name on the wrong TLD as a typo first', () => {
    expect(checkTypedEmail('anna@gmail.de')).toEqual({
      reason: 'likely_typo',
      message: 'Did you mean anna@gmail.com?',
      suggestion: 'anna@gmail.com',
    })
    // Confirmed, it is an ordinary (unknown provider) address
    expect(checkTypedEmail('anna@gmail.de', { confirmTypo: true })).toBeNull()
  })

  it('rejects an address that breaks its provider rules', () => {
    const gmail = checkTypedEmail('anna@gmail.com')
    expect(gmail?.reason).toBe('provider_rules')
    expect(gmail?.provider).toBe('gmail')
    expect(gmail?.message).not.toMatch(/[\u2013\u2014]/)
    expect(checkTypedEmail('1anna@outlook.com')?.reason).toBe('provider_rules')
    expect(checkTypedEmail('anna+tag@tuta.com')?.reason).toBe('provider_rules')
    // Confirming a typo does not confirm away the rules
    expect(
      checkTypedEmail('an@gmail.com', { confirmTypo: true })?.reason
    ).toBe('provider_rules')
    // An iCloud length problem is a review, not a refusal
    expect(checkTypedEmail('ab@icloud.com')).toBeNull()
  })

  it('reports a bad shape as invalid_email', () => {
    expect(checkTypedEmail('anna@nodot')).toEqual({
      reason: 'invalid_email',
      message: EMAIL_REFUSAL_MESSAGES.invalid_email,
    })
  })

  it('reports a reserved domain as undeliverable_domain', () => {
    expect(checkTypedEmail('anna@example.com')?.reason).toBe(
      'undeliverable_domain'
    )
    // Even when a typo was confirmed: the domain can never get mail.
    expect(
      checkTypedEmail('anna@acme.test', { confirmTypo: true })?.reason
    ).toBe('undeliverable_domain')
  })

  it('reports a likely typo with the suggestion', () => {
    expect(checkTypedEmail('anna@gmial.com')).toEqual({
      reason: 'likely_typo',
      message: 'Did you mean anna@gmail.com?',
      suggestion: 'anna@gmail.com',
    })
  })

  it('accepts a likely typo the person confirmed', () => {
    expect(checkTypedEmail('anna@gmial.com', { confirmTypo: true })).toBeNull()
  })
})


describe('validateEmailAddress', () => {
  /**
   * The codes of an address's findings.
   * @param email - The address
   * @returns The reason codes
   */
  const codes = (email: string): string[] =>
    validateEmailAddress(email, withList).findings.map(findingReasonCode)

  it('sends a clean address with its keys', () => {
    const result = validateEmailAddress(' Anna.Lund+promo@Gmail.com ', withList)
    expect(result.verdict).toBe('send')
    expect(result.findings).toEqual([])
    expect(result.normalized).toBe('anna.lund+promo@gmail.com')
    expect(result.canonical).toBe('annalund@gmail.com')
  })

  it('stops at a syntax problem', () => {
    const result = validateEmailAddress('not an address', withList)
    expect(result.verdict).toBe('reject')
    expect(codes('not an address')).toEqual(['syntax_invalid'])
  })

  it('rejects unknown and reserved TLDs, accepts IDN via punycode', () => {
    expect(codes('user@example.notatld')).toEqual(['tld_unknown'])
    expect(codes('user@acme.test')).toEqual(['reserved_domain'])
    expect(codes('user@пример.рф')).toEqual([])
  })

  it('reviews a suspected typo with the suggestion, before the rules', () => {
    const result = validateEmailAddress('anna@gmail.de', withList)
    expect(result.verdict).toBe('review')
    expect(result.findings).toEqual([
      {
        code: 'domain_typo_suspected',
        verdict: 'review',
        message: 'Did you mean anna@gmail.com?',
        suggestion: 'anna@gmail.com',
      },
    ])
    // A typo squat domain is on the disposable list as well
    expect(codes('anna@gmial.com')).toEqual([
      'domain_typo_suspected',
      'disposable_domain',
    ])
    expect(codes('anna@hotmial.com')).toContain('domain_typo_suspected')
  })

  it('names the provider in the rules code', () => {
    expect(codes('anna@gmail.com')).toEqual(['provider_rules_invalid:gmail'])
    expect(codes('1john@outlook.com')).toEqual([
      'provider_rules_invalid:microsoft',
    ])
    expect(codes('anna+x@tuta.com')).toEqual(['provider_rules_invalid:tuta'])
    const icloud = validateEmailAddress('ab@icloud.com', withList)
    expect(icloud.verdict).toBe('review')
    expect(codes('ab@icloud.com')).toEqual(['provider_rules_review:icloud'])
  })

  it('rejects a disposable domain and reviews a role account', () => {
    expect(
      validateEmailAddress('anna@mailinator.com', withList).verdict
    ).toBe('reject')
    expect(codes('anna@mailinator.com')).toEqual(['disposable_domain'])
    const role = validateEmailAddress('info@acme.com', withList)
    expect(role.verdict).toBe('review')
    expect(codes('info@acme.com')).toEqual(['role_account'])
  })

  it('reports every finding at once and rejects over reviews', () => {
    const result = validateEmailAddress('info@gmail.de', withList)
    expect(result.verdict).toBe('review')
    expect(codes('info@gmail.de')).toEqual([
      'domain_typo_suspected',
      'role_account',
    ])
    expect(codes('info@mailinator.com')).toEqual([
      'disposable_domain',
      'role_account',
    ])
    const both = validateEmailAddress('info@mailinator.com', withList)
    expect(both.verdict).toBe('reject')
    for (const finding of both.findings) {
      expect(finding.message).not.toMatch(/[\u2013\u2014]/)
    }
  })
})

describe('checkTypedEmail with the disposable list', () => {
  it('refuses a disposable domain last, typo confirmed or not', () => {
    const options = { disposable: isDisposableDomain }
    expect(checkTypedEmail('anna.lund@gmail.com', options)).toBeNull()
    expect(checkTypedEmail('anna@gmial.com', options)?.reason).toBe(
      'likely_typo'
    )
    expect(checkTypedEmail('anna@gmail.com', options)?.reason).toBe(
      'provider_rules'
    )
    const disposable = checkTypedEmail('anna@mailinator.com', options)
    expect(disposable).toEqual({
      reason: 'disposable_domain',
      message: EMAIL_REFUSAL_MESSAGES.disposable_domain,
    })
    expect(
      checkTypedEmail('anna@mailinator.com', {
        ...options,
        confirmTypo: true,
      })?.reason
    ).toBe('disposable_domain')
    // Without the list nothing is disposable
    expect(checkTypedEmail('anna@mailinator.com')).toBeNull()
  })
})

describe('validateEmailAddress without the list', () => {
  it('finds nothing disposable, which keeps the list optional', () => {
    expect(validateEmailAddress('anna@mailinator.com').verdict).toBe('send')
    expect(validateEmailAddress('info@acme.com').findings[0]?.code).toBe(
      'role_account'
    )
  })
})

describe('verdicts and messages', () => {
  it('rejects over reviews over sends', () => {
    expect(verdictOfFindings([])).toBe('send')
    expect(
      verdictOfFindings([{ code: 'verifier_failed', verdict: 'send',
        message: 'x' }])
    ).toBe('send')
    expect(
      verdictOfFindings([
        { code: 'role_account', verdict: 'review', message: 'x' },
        { code: 'verifier_failed', verdict: 'send', message: 'x' },
      ])
    ).toBe('review')
    expect(
      verdictOfFindings([
        { code: 'role_account', verdict: 'review', message: 'x' },
        { code: 'tld_unknown', verdict: 'reject', message: 'x' },
      ])
    ).toBe('reject')
  })

  it('has a text for every reason and no dashes', () => {
    for (const reason of EMAIL_REFUSAL_REASONS) {
      expect(EMAIL_REFUSAL_MESSAGES[reason]).toBeTruthy()
      expect(EMAIL_REFUSAL_MESSAGES[reason]).not.toMatch(/[\u2013\u2014]/)
    }
    expect(likelyTypoMessage('a@gmail.com')).toBe('Did you mean a@gmail.com?')
  })
})
