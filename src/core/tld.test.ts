import { describe, expect, it } from 'vitest'
import { IANA_TLDS, hasValidTld } from './tld'

describe('hasValidTld', () => {
  it('bundles the IANA list with the usual and the punycode labels', () => {
    expect(IANA_TLDS.size).toBeGreaterThan(1000)
    for (const tld of ['com', 'nl', 'eu', 'de', 'co', 'xn--p1ai']) {
      expect(IANA_TLDS.has(tld), tld).toBe(true)
    }
    for (const tld of ['test', 'local', 'con', 'notatld']) {
      expect(IANA_TLDS.has(tld), tld).toBe(false)
    }
  })

  it('reads the last label, any case, trailing dot allowed', () => {
    expect(hasValidTld('example.com')).toBe(true)
    expect(hasValidTld('A.B.Example.CO.UK')).toBe(true)
    expect(hasValidTld('example.com.')).toBe(true)
    expect(hasValidTld('xn--80ahbyjlf.xn--p1ai')).toBe(true)
  })

  it('refuses unknown labels and names without a dot', () => {
    expect(hasValidTld('11111rs-access323.del')).toBe(false)
    expect(hasValidTld('gmial.con')).toBe(false)
    expect(hasValidTld('localhost')).toBe(false)
    expect(hasValidTld('.com')).toBe(false)
    expect(hasValidTld('example.')).toBe(false)
    expect(hasValidTld('')).toBe(false)
  })
})
