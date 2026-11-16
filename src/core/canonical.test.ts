import { describe, expect, it } from 'vitest'
import {
  ROLE_ACCOUNT_NAMES,
  canonicalEmailKey,
  checkProviderRules,
  isKnownTld,
  isRoleAccount,
  splitEmail,
  stripPlusTag,
  toAsciiDomain,
} from './canonical'

describe('canonicalEmailKey', () => {
  it('splits and strips plus tags', () => {
    expect(splitEmail(' A@B.c ')).toEqual({ local: 'a', domain: 'b.c' })
    expect(splitEmail('nope')).toBeNull()
    expect(stripPlusTag('anna+x+y')).toBe('anna')
    expect(stripPlusTag('anna')).toBe('anna')
  })

  it('removes dots, strips the tag and folds googlemail at Gmail', () => {
    expect(canonicalEmailKey('Anna.Lund+promo@Gmail.com')).toBe(
      'annalund@gmail.com'
    )
    expect(canonicalEmailKey('a.n.n.a.lund@googlemail.com')).toBe(
      'annalund@gmail.com'
    )
    expect(canonicalEmailKey('annalund@gmail.com')).toBe('annalund@gmail.com')
  })

  it('treats dots, hyphens and underscores as transparent at Proton', () => {
    for (const variant of [
      'user.name@proton.me',
      'user_name@proton.me',
      'user-name@proton.me',
      'username+tag@proton.me',
    ]) {
      expect(canonicalEmailKey(variant), variant).toBe('username@proton.me')
    }
    // No merge across Proton domains
    expect(canonicalEmailKey('username@protonmail.com')).toBe(
      'username@protonmail.com'
    )
  })

  it('keeps dots significant at Microsoft and iCloud, strips the tag', () => {
    expect(canonicalEmailKey('John.Doe+x@outlook.com')).toBe(
      'john.doe@outlook.com'
    )
    expect(canonicalEmailKey('johndoe@outlook.com')).not.toBe(
      canonicalEmailKey('john.doe@outlook.com')
    )
    expect(canonicalEmailKey('Anna.Lund+x@icloud.com')).toBe(
      'anna.lund@icloud.com'
    )
  })

  it('changes nothing at Tuta and strips only the tag elsewhere', () => {
    expect(canonicalEmailKey('Anna.Lund+x@tuta.com')).toBe(
      'anna.lund+x@tuta.com'
    )
    expect(canonicalEmailKey(' Anna.Lund+x@Acme.COM ')).toBe(
      'anna.lund@acme.com'
    )
    expect(canonicalEmailKey('nonsense')).toBe('nonsense')
  })
})

describe('checkProviderRules', () => {
  it('rejects Gmail local parts outside 6 to 30 letters and digits', () => {
    expect(checkProviderRules('anna.lund@gmail.com')).toBeNull()
    expect(checkProviderRules('a.n.n.a.l.u.n.d+tag@googlemail.com')).toBeNull()
    for (const bad of [
      'anna@gmail.com',
      'an.na@gmail.com',
      `${'a'.repeat(31)}@gmail.com`,
      'anna_lund@gmail.com',
      'anna-lund@gmail.com',
      '.annalund@gmail.com',
      'annalund.@gmail.com',
      'anna..lund@gmail.com',
    ]) {
      const problem = checkProviderRules(bad)
      expect(problem?.verdict, bad).toBe('reject')
      expect(problem?.provider, bad).toBe('gmail')
    }
  })

  it('makes Microsoft start with a letter, dots significant', () => {
    expect(checkProviderRules('john.doe@outlook.com')).toBeNull()
    expect(checkProviderRules('j_doe-1+x@hotmail.co.uk')).toBeNull()
    expect(checkProviderRules('j@live.nl')).toBeNull()
    for (const bad of [
      '1john@outlook.com',
      '_john@hotmail.com',
      'john..doe@outlook.com',
      '.john@live.com',
      'john.@msn.com',
      'john!doe@outlook.de',
    ]) {
      expect(checkProviderRules(bad)?.verdict, bad).toBe('reject')
    }
  })

  it('checks the Proton charset and dot rules', () => {
    expect(checkProviderRules('user.name_x-y+tag@proton.me')).toBeNull()
    expect(checkProviderRules('user..name@proton.me')?.verdict).toBe('reject')
    expect(checkProviderRules('user!@pm.me')?.verdict).toBe('reject')
  })

  it('rejects a plus tag at Tuta and nothing else there', () => {
    expect(checkProviderRules('anna+x@tuta.com')?.verdict).toBe('reject')
    expect(checkProviderRules('anna+x@tutanota.de')?.provider).toBe('tuta')
    expect(checkProviderRules('anna.lund@tuta.io')).toBeNull()
  })

  it('reviews an iCloud local part outside 3 to 20 characters', () => {
    expect(checkProviderRules('anna@icloud.com')).toBeNull()
    expect(checkProviderRules('ab@icloud.com')?.verdict).toBe('review')
    expect(checkProviderRules(`${'a'.repeat(21)}@me.com`)?.verdict).toBe(
      'review'
    )
    expect(checkProviderRules('abc+tag@mac.com')).toBeNull()
  })

  it('has no rules for other domains and no dashes in its texts', () => {
    expect(checkProviderRules('anything!@yahoo.com')).toBeNull()
    expect(checkProviderRules('x@acme.com')).toBeNull()
    for (const bad of ['anna@gmail.com', '1j@outlook.com', 'a+b@tuta.com']) {
      expect(checkProviderRules(bad)?.message).not.toMatch(/[\u2013\u2014]/)
    }
  })
})

describe('isRoleAccount', () => {
  it('knows the role names, plus tag or not', () => {
    for (const name of ['admin', 'info', 'support', 'noreply', 'no-reply',
      'postmaster', 'abuse', 'webmaster', 'sales', 'contact', 'hostmaster']) {
      expect(ROLE_ACCOUNT_NAMES).toContain(name)
      expect(isRoleAccount(`${name}@acme.com`), name).toBe(true)
    }
    expect(isRoleAccount('Info+x@acme.com')).toBe(true)
    expect(isRoleAccount('anna@acme.com')).toBe(false)
    expect(isRoleAccount('nonsense')).toBe(false)
  })
})

describe('isKnownTld', () => {
  it('accepts IANA TLDs, including IDN ones via punycode', () => {
    expect(isKnownTld('acme.com')).toBe(true)
    expect(isKnownTld('ACME.CO.UK.')).toBe(true)
    expect(isKnownTld('пример.рф')).toBe(true)
    expect(isKnownTld('xn--80ahbyjlf.xn--p1ai')).toBe(true)
    expect(toAsciiDomain('пример.рф')).toBe('xn--e1afmkfd.xn--p1ai')
  })

  it('refuses made up, reserved and bare labels', () => {
    expect(isKnownTld('example.notatld')).toBe(false)
    expect(isKnownTld('acme.test')).toBe(false)
    expect(isKnownTld('localhost')).toBe(false)
    expect(isKnownTld('')).toBe(false)
    expect(isKnownTld('bad host.com')).toBe(false)
    expect(toAsciiDomain('a/b.com')).toBeNull()
  })
})
