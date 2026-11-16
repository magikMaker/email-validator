import { describe, expect, it } from 'vitest'
import { emailHash, sha256Hex, toHex } from './hash'

describe('hashes', () => {
  it('hashes with SHA-256 as lowercase hex', async () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff')
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('hashes an address trimmed and lowercased', async () => {
    const key = await emailHash('anna@acme.nl')
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await emailHash(' Anna@ACME.nl ')).toBe(key)
    expect(key).toBe(await sha256Hex('anna@acme.nl'))
  })
})
