import { describe, expect, it } from 'vitest'
import {
  EMAIL_PROVIDERS,
  PROVIDER_DOMAINS,
  providerOfDomain,
  providerOfEmail,
  wrongTldSuggestion,
} from './mail-providers'

describe('provider table', () => {
  it('lists every domain once and knows the big providers', () => {
    expect(new Set(PROVIDER_DOMAINS).size).toBe(PROVIDER_DOMAINS.length)
    for (const provider of EMAIL_PROVIDERS) {
      expect(provider.domains, provider.id).toContain(provider.primaryDomain)
      for (const domain of provider.domains) {
        expect(domain).toBe(domain.toLowerCase())
      }
    }
    expect(providerOfDomain('GMAIL.com')?.id).toBe('gmail')
    expect(providerOfDomain('googlemail.com')?.id).toBe('gmail')
    expect(providerOfDomain('hotmail.co.uk')?.id).toBe('microsoft')
    expect(providerOfDomain('pm.me')?.id).toBe('proton')
    expect(providerOfDomain('keemail.me')?.id).toBe('tuta')
    expect(providerOfDomain('mac.com')?.id).toBe('icloud')
    expect(providerOfDomain('ziggo.nl')?.id).toBe('dutch-isps')
    expect(providerOfDomain('acme.com')).toBeNull()
    expect(providerOfEmail('x@yahoo.co.uk')?.id).toBe('yahoo')
    expect(providerOfEmail('no-at')).toBeNull()
  })

  it('suggests the provider domain for a known name on another TLD', () => {
    expect(wrongTldSuggestion('gmail.de')).toBe('gmail.com')
    expect(wrongTldSuggestion('gmail.co.uk')).toBe('gmail.com')
    expect(wrongTldSuggestion('proton.com')).toBe('proton.me')
    expect(wrongTldSuggestion('protonmail.me')).toBe('protonmail.com')
    expect(wrongTldSuggestion('outlook.nl')).toBe('outlook.com')
    expect(wrongTldSuggestion('Hotmail.XYZ')).toBe('hotmail.com')
    // A real domain of the provider is not a typo
    expect(wrongTldSuggestion('hotmail.nl')).toBeNull()
    expect(wrongTldSuggestion('gmail.com')).toBeNull()
    // Generic names are not typo names
    expect(wrongTldSuggestion('mail.de')).toBeNull()
    expect(wrongTldSuggestion('live.xyz')).toBeNull()
    expect(wrongTldSuggestion('acme.com')).toBeNull()
    expect(wrongTldSuggestion('nodot')).toBeNull()
  })
})
