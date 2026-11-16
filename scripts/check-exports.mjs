#!/usr/bin/env node

/**
 * Load every public entry of the built package by its name, once with
 * `import` (ESM) and once with `require` (CommonJS), and check that the
 * main exports are there. Catches a broken `exports` map, a missing file
 * or a format mix-up before a release does.
 *
 * Usage (after `yarn build`):
 *   node scripts/check-exports.mjs
 */

import { createRequire } from 'node:module'
import { green, red } from 'barva'

const require = createRequire(import.meta.url)

/** Each entry and exports it must have. */
const ENTRIES = {
  '@magikmaker/email-validator': [
    'checkEmailShape',
    'canonicalEmailKey',
    'checkProviderRules',
    'isKnownTld',
    'toAsciiDomain',
    'suggestEmailDomain',
    'isRoleAccount',
    'validateEmailAddress',
    'checkTypedEmail',
    'createValidator',
    'createMemoryCache',
    'gatePolicy',
    'reviewPolicy',
    'emailHash',
    'VerifierError',
  ],
  '@magikmaker/email-validator/disposable': [
    'DISPOSABLE_DOMAINS',
    'isDisposableDomain',
    'isDisposableEmail',
    'createDisposableCheck',
  ],
  '@magikmaker/email-validator/dns': [
    'createDomainCheck',
    'checkEmailDomain',
    'resolveDomainVerdict',
  ],
  '@magikmaker/email-validator/providers/kickbox': [
    'kickbox',
    'kickboxStatusOf',
    'kickboxRawRecord',
  ],
  '@magikmaker/email-validator/providers/mock': ['mock'],
  '@magikmaker/email-validator/kickbox-csv': [
    'parseKickboxCsv',
    'parseCsv',
    'CsvImportError',
  ],
}

/**
 * Check one loaded module.
 * @param {string} label - The entry and the format
 * @param {Record<string, unknown>} loaded - The module
 * @param {string[]} names - The exports it must have
 * @returns {string[]} The problems
 */
function check(label, loaded, names) {
  return names
    .filter((name) => loaded[name] === undefined)
    .map((name) => `${label} misses ${name}`)
}

/**
 * Load every entry both ways.
 */
async function main() {
  const problems = []
  for (const [name, exports] of Object.entries(ENTRIES)) {
    problems.push(...check(`${name} (import)`, await import(name), exports))
    problems.push(...check(`${name} (require)`, require(name), exports))
  }
  const { validateEmailAddress } = require('@magikmaker/email-validator')
  const { isDisposableDomain } = await import(
    '@magikmaker/email-validator/disposable'
  )
  const verdict = validateEmailAddress('a@mailinator.com', {
    disposable: isDisposableDomain,
  }).verdict
  if (verdict !== 'reject') {
    problems.push('CJS core with ESM disposable list did not reject')
  }
  if (problems.length > 0) {
    problems.forEach((problem) => console.error(red.bold`✗ ${problem}`))
    process.exitCode = 1
    return
  }
  const count = String(Object.keys(ENTRIES).length)
  console.log(green`✓ ${count} entries load with import and require`)
}

main().catch((error) => {
  console.error(red.bold`Export check failed: ${error.message}`)
  process.exitCode = 1
})
