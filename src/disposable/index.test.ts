import { describe, expect, it } from 'vitest'
import { PROVIDER_DOMAINS } from '../core/mail-providers'
import {
  DISPOSABLE_DOMAINS,
  createDisposableCheck,
  isDisposableDomain,
  isDisposableEmail,
} from './index'

describe('disposable domains', () => {
  it('bundles the blocklist and never a real provider', () => {
    expect(DISPOSABLE_DOMAINS.size).toBeGreaterThan(5000)
    for (const domain of [
      'mailinator.com',
      'yopmail.com',
      'guerrillamail.com',
    ]) {
      expect(DISPOSABLE_DOMAINS.has(domain), domain).toBe(true)
    }
    for (const domain of ['gmail.com', 'outlook.com', 'yahoo.com',
      'acme.com']) {
      expect(isDisposableDomain(domain), domain).toBe(false)
    }
  })

  it('never lists a domain of the provider table', () => {
    for (const domain of PROVIDER_DOMAINS) {
      expect(DISPOSABLE_DOMAINS.has(domain), domain).toBe(false)
    }
  })

  it('matches a subdomain of a listed domain, any case', () => {
    expect(isDisposableDomain('Mailinator.COM')).toBe(true)
    expect(isDisposableDomain(' mail.yopmail.com ')).toBe(true)
    expect(isDisposableDomain('com')).toBe(false)
    expect(isDisposableEmail('x@mailinator.com')).toBe(true)
    expect(isDisposableEmail('x@acme.com')).toBe(false)
    expect(isDisposableEmail('nonsense')).toBe(false)
  })
})

describe('createDisposableCheck', () => {
  it('lets allow win over block and over the list', () => {
    const check = createDisposableCheck({
      allow: ['Mailinator.com', 'acme.com'],
      block: ['acme.com', 'throwaway.example.org'],
    })
    expect(check('mailinator.com')).toBe(false)
    expect(check('eu.mailinator.com')).toBe(false)
    expect(check('acme.com')).toBe(false)
    expect(check('throwaway.example.org')).toBe(true)
    expect(check('x.throwaway.example.org')).toBe(true)
    expect(check('yopmail.com')).toBe(true)
    expect(check('gmail.com')).toBe(false)
  })

  it('is the bundled list without options', () => {
    const check = createDisposableCheck()
    expect(check('yopmail.com')).toBe(true)
    expect(check('acme.com')).toBe(false)
  })
})
