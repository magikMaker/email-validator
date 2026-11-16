import { describe, expect, it } from 'vitest'
import { PROVIDER_DOMAINS } from './mail-providers'
import {
  COMMON_EMAIL_DOMAINS,
  checkEmailShape,
  editDistance,
  suggestEmailDomain,
} from './address'

describe('checkEmailShape', () => {
  it('accepts ordinary, IDN and punycode addresses', () => {
    for (const email of [
      'anna@gmail.com',
      ' Anna.Lund+dux@Example-Mail.COM ',
      'a@b.co',
      'o.reilly@sub.domain.co.uk',
      'müller@bücher.de',
      'user@xn--bcher-kva.de',
      'user@mail.xn--p1ai',
      'x@123.example-site.com',
      `${'a'.repeat(64)}@long-local-part.com`,
    ]) {
      expect(checkEmailShape(email), email).toBeNull()
    }
  })

  it('reports syntax problems Zod lets through or we want stricter', () => {
    for (const email of [
      '',
      'no-at-sign.com',
      'two@at@signs.com',
      '@nolocal.com',
      'nodomain@',
      'user@[192.168.0.1]',
      'user@192.168.0.1',
      'user@nodot',
      'user@-bad.com',
      'user@bad-.com',
      'user@bad..com',
      'user@.leadingdot.com',
      'user@trailingdot.com.',
      'user@domain.c',
      'user@domain.123',
      'user@under_score.com',
      `user@${'a'.repeat(64)}.com`,
      `${'a'.repeat(65)}@gmail.com`,
      'has space@gmail.com',
      `${'a'.repeat(60)}@${'b'.repeat(190)}.com`,
    ]) {
      expect(checkEmailShape(email), email).toBe('syntax')
    }
  })

  it('reports the reserved names as undeliverable domains', () => {
    for (const email of [
      'anna@example.com',
      'anna@EXAMPLE.NET',
      'anna@example.org',
      'anna@mail.example.com',
      'anna@localhost',
      'anna@mail.localhost',
      'anna@acme.test',
      'anna@support.example.test',
      'anna@acme.example',
      'anna@acme.invalid',
      'anna@printer.local',
    ]) {
      expect(checkEmailShape(email), email).toBe('reserved_domain')
    }
    // Real domains that merely contain a reserved word are fine.
    expect(checkEmailShape('anna@example-mail.com')).toBeNull()
    expect(checkEmailShape('anna@testing.com')).toBeNull()
    expect(checkEmailShape('anna@localhost.com')).toBeNull()
  })
})

describe('editDistance', () => {
  it('counts inserts, deletes, substitutions and one swap as one', () => {
    expect(editDistance('gmail', 'gmail')).toBe(0)
    expect(editDistance('gmial', 'gmail')).toBe(1)
    expect(editDistance('gmal', 'gmail')).toBe(1)
    expect(editDistance('gmaill', 'gmail')).toBe(1)
    expect(editDistance('gmeil', 'gmail')).toBe(1)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('yahoo.de', 'yahoo.com')).toBe(3)
  })
})

describe('suggestEmailDomain', () => {
  it('keeps the list in the agreed order', () => {
    expect(COMMON_EMAIL_DOMAINS[0]).toBe('gmail.com')
    expect(COMMON_EMAIL_DOMAINS.indexOf('mail.com')).toBe(
      COMMON_EMAIL_DOMAINS.indexOf('aol.com') + 1
    )
    expect(new Set(COMMON_EMAIL_DOMAINS).size).toBe(COMMON_EMAIL_DOMAINS.length)
    // The 44 frequent domains first, then the rest of the provider table
    expect(COMMON_EMAIL_DOMAINS.slice(0, 44)).toContain('mail.ru')
    expect(COMMON_EMAIL_DOMAINS.indexOf('hotmail.fr')).toBeGreaterThan(43)
    expect(COMMON_EMAIL_DOMAINS).not.toContain('outlook.nl')
    for (const domain of PROVIDER_DOMAINS) {
      expect(COMMON_EMAIL_DOMAINS, domain).toContain(domain)
    }
  })

  it('suggests the provider domain for a known name on the wrong TLD', () => {
    const table: [string, string][] = [
      ['gmail.de', 'gmail.com'],
      ['gmail.nl', 'gmail.com'],
      ['gmail.co.uk', 'gmail.com'],
      ['googlemail.de', 'googlemail.com'],
      ['proton.com', 'proton.me'],
      ['protonmail.me', 'protonmail.com'],
      ['outlook.nl', 'outlook.com'],
      ['hotmail.xyz', 'hotmail.com'],
      ['tutanota.co', 'tutanota.com'],
      ['icloud.de', 'icloud.com'],
    ]
    for (const [typed, expected] of table) {
      expect(suggestEmailDomain(`anna@${typed}`), typed).toBe(
        `anna@${expected}`
      )
    }
    // Real provider domains on other TLDs are never a typo
    for (const domain of ['hotmail.co.uk', 'outlook.de', 'live.nl']) {
      expect(suggestEmailDomain(`anna@${domain}`), domain).toBeNull()
    }
  })

  it('suggests the full address for a close typo', () => {
    const table: [string, string][] = [
      ['gmial.com', 'gmail.com'],
      ['gmail.con', 'gmail.com'],
      ['gmail.co', 'gmail.com'],
      ['hotmial.com', 'hotmail.com'],
      ['outlok.com', 'outlook.com'],
      ['icoud.com', 'icloud.com'],
      ['yaho.com', 'yahoo.com'],
      ['ziggo.n', 'ziggo.nl'],
    ]
    for (const [typed, expected] of table) {
      expect(suggestEmailDomain(`anna@${typed}`), typed).toBe(
        `anna@${expected}`
      )
    }
  })

  it('keeps the local part as typed and lowercases only the domain', () => {
    expect(suggestEmailDomain(' Anna.Lund@GMIAL.com ')).toBe(
      'Anna.Lund@gmail.com'
    )
  })

  it('gives no hint for real domains, listed domains or junk', () => {
    for (const domain of [
      'gmx.at',
      'yahoo.de',
      'acme.com',
      'provaz.eu',
      'mail.com',
      'gmail.com',
      'nodomain',
      'smokingmedia.com',
      'hotmail.de',
      'live.be',
      'orange.be',
      '',
    ]) {
      expect(suggestEmailDomain(`anna@${domain}`), domain).toBeNull()
    }
    expect(suggestEmailDomain('no-at-sign')).toBeNull()
  })

  it('allows a distance of 2 only for long domains with the same TLD', () => {
    expect(suggestEmailDomain('anna@hotmaill.co')).toBeNull()
    expect(suggestEmailDomain('anna@hotmali.com')).toBe('anna@hotmail.com')
    expect(suggestEmailDomain('anna@protonmial.com')).toBe(
      'anna@protonmail.com'
    )
  })
})
