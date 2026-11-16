/**
 * Hashes of addresses, so a cache or a log holds a digest and never the
 * address itself. Web Crypto only: the global `crypto` is there in
 * Workers, browsers and Node 20+, so nothing is imported.
 */

/**
 * Hex encode bytes.
 * @param bytes - The bytes
 * @returns Lowercase hex, two characters per byte
 */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * SHA-256 of a string, as hex.
 * @param value - The value
 * @returns The 64 character hex digest
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  )
  return toHex(new Uint8Array(digest))
}

/**
 * The cache key of an address: sha256 hex of
 * `address.trim().toLowerCase()`, so the same mailbox written with other
 * casing or stray whitespace hashes the same.
 * @param address - The address
 * @returns The hex digest
 */
export function emailHash(address: string): Promise<string> {
  return sha256Hex(address.trim().toLowerCase())
}
