#!/usr/bin/env node

/**
 * Refresh the bundled list of disposable (throwaway) email domains.
 *
 * The default source is the conservative community blocklist
 * disposable-email-domains (CC0):
 *   https://github.com/disposable-email-domains/disposable-email-domains
 * With `--broad` the much larger, more aggressive list of
 * disposable/disposable-email-domains (MIT) is merged in as well. It is
 * not part of the default set: it catches more throwaway services and
 * also more false positives.
 *
 * Two lists always win over every source, so a real mailbox provider is
 * never blocked:
 * - lists/disposable-allowlist.txt, our own false positives;
 * - every domain of the provider table (src/data/email-providers.json).
 *
 * The result is written to src/data/disposable-domains.ts as one newline
 * separated string of lowercase domains; the `disposable` entry turns it
 * into a Set at load time.
 *
 * Run by hand, or via the weekly workflow
 * .github/workflows/update-lists.yml, which opens a pull request when
 * the list changed.
 *
 * Usage:
 *   node scripts/update-disposable-domains.mjs [--broad]
 *
 * Exits 0 on success, whether or not the file changed. Exits non zero on
 * a hard failure (network error, malformed line, a suspiciously short
 * list, a big provider on the list), and then leaves the file as it is.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bold, cyan, green, red, yellow } from 'barva'

/** The repository root. */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The generated module. */
const OUTPUT_PATH = path.join(ROOT, 'src', 'data', 'disposable-domains.ts')

/** Our own false positives, one domain per line, `#` comments. */
const ALLOWLIST_PATH = path.join(ROOT, 'lists', 'disposable-allowlist.txt')

/** The provider table, whose domains are never disposable. */
const PROVIDERS_PATH = path.join(ROOT, 'src', 'data', 'email-providers.json')

/**
 * The sources. `broad` ones are only fetched with `--broad`.
 * @type {{ name: string, url: string, license: string, broad: boolean,
 *   minEntries: number }[]}
 */
const SOURCES = [
  {
    name: 'disposable-email-domains',
    url:
      'https://raw.githubusercontent.com/disposable-email-domains/' +
      'disposable-email-domains/main/disposable_email_blocklist.conf',
    license: 'CC0-1.0',
    broad: false,
    minEntries: 5000,
  },
  {
    name: 'disposable/disposable-email-domains',
    url:
      'https://raw.githubusercontent.com/disposable/' +
      'disposable-email-domains/master/domains.txt',
    license: 'MIT',
    broad: true,
    minEntries: 20000,
  },
]

/** Domains every sane copy of the default list has. */
const SANITY_DOMAINS = ['mailinator.com', 'yopmail.com', 'guerrillamail.com']

/**
 * Domains that must never be on a source: when one is, the source is
 * broken and the run stops.
 */
const NEVER_DOMAINS = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com']

/** A host name as the lists write it. */
const DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z0-9-]+$/

/**
 * Read a list file: one domain per line, blank lines and `#` comments
 * ignored, lowercased.
 * @param {string} raw - The file
 * @param {string} name - The list's name, for errors
 * @returns {Set<string>} The domains
 */
function parseList(raw, name) {
  const domains = new Set()
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.replace(/#.*$/, '').trim().toLowerCase()
    if (!trimmed) {
      continue
    }
    if (!DOMAIN_PATTERN.test(trimmed)) {
      throw new Error(`Unexpected line in ${name}: "${trimmed}"`)
    }
    domains.add(trimmed)
  }
  return domains
}

/**
 * Fetch and check one source.
 * @param {(typeof SOURCES)[number]} source - The source
 * @returns {Promise<Set<string>>} Its domains
 */
async function fetchSource(source) {
  console.log(cyan`Fetching ${source.name} (${source.license})`)
  const response = await fetch(source.url)
  if (!response.ok) {
    throw new Error(
      `${source.name} answered HTTP ${response.status} ` +
        `${response.statusText}`
    )
  }
  const domains = parseList(await response.text(), source.name)
  if (domains.size < source.minEntries) {
    throw new Error(
      `Suspiciously short list from ${source.name} (${domains.size} ` +
        'entries), refusing to overwrite.'
    )
  }
  for (const never of NEVER_DOMAINS) {
    if (domains.has(never)) {
      throw new Error(
        `${source.name} lists ${never}, refusing to overwrite.`
      )
    }
  }
  console.log(green`  ${String(domains.size)} domains`)
  return domains
}

/**
 * The domains that always win: the allowlist and the provider table.
 * @returns {Set<string>} Domains never written to the list
 */
function readAllowed() {
  const allowed = fs.existsSync(ALLOWLIST_PATH)
    ? parseList(fs.readFileSync(ALLOWLIST_PATH, 'utf8'), 'the allowlist')
    : new Set()
  const table = JSON.parse(fs.readFileSync(PROVIDERS_PATH, 'utf8'))
  for (const provider of table.providers) {
    for (const domain of provider.domains) {
      allowed.add(domain)
    }
  }
  return allowed
}

/**
 * Render the module.
 * @param {string[]} domains - Sorted domains
 * @param {(typeof SOURCES)[number][]} used - The sources merged
 * @returns {string} The module source
 */
function renderModule(domains, used) {
  const today = new Date().toISOString().slice(0, 10)
  const sources = used
    .map((source) => ` * - ${source.url} (${source.license})`)
    .join('\n')
  return `/**
 * Disposable (throwaway) email domains.
 *
 * Generated by scripts/update-disposable-domains.mjs, do not edit by
 * hand. Refresh it by running the script, or let the weekly workflow
 * .github/workflows/update-lists.yml open a pull request. False
 * positives go in lists/disposable-allowlist.txt.
 *
 * Sources:
${sources}
 * Fetched: ${today}
 * Entry count: ${domains.length}
 *
 * One domain per line in a single string: the \`disposable\` entry
 * builds a Set from it at load time, which keeps the bundle small.
 */

/** One lowercase domain per line. */
export const DISPOSABLE_DOMAIN_LIST: string = \`
${domains.join('\n')}
\`
`
}

/**
 * The list part of a generated module, without the dated header.
 * @param {string | null} source - A module source
 * @returns {string | null} The domains
 */
function listOf(source) {
  return source?.split('`').at(-2) ?? null
}

/**
 * Fetch, merge, filter and write the module when the list changed.
 */
async function main() {
  const broad = process.argv.includes('--broad')
  const used = SOURCES.filter((source) => broad || !source.broad)
  const merged = new Set()
  for (const source of used) {
    for (const domain of await fetchSource(source)) {
      merged.add(domain)
    }
  }
  for (const must of SANITY_DOMAINS) {
    if (!merged.has(must)) {
      throw new Error(`The list misses ${must}, refusing to overwrite.`)
    }
  }
  const allowed = readAllowed()
  const dropped = [...merged].filter((domain) => allowed.has(domain))
  for (const domain of dropped) {
    merged.delete(domain)
  }
  if (dropped.length > 0) {
    console.log(
      yellow`Left out ${String(dropped.length)} allowed domains: ` +
        dropped.sort().join(', ')
    )
  }
  const domains = [...merged].sort()
  console.log(green`Merged ${String(domains.length)} disposable domains`)

  const next = renderModule(domains, used)
  const previous = fs.existsSync(OUTPUT_PATH)
    ? fs.readFileSync(OUTPUT_PATH, 'utf8')
    : null
  if (listOf(previous) === listOf(next)) {
    console.log(yellow`No changes, ${OUTPUT_PATH} is current`)
    return
  }
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, next)
  console.log(green.bold`Wrote ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(
    red.bold`Failed to update the disposable domains: ${error.message}`
  )
  console.error(bold`The existing file is left as it is.`)
  process.exitCode = 1
})
