#!/usr/bin/env node

/**
 * Measure what each entry costs a consumer and guard the entry
 * isolation. Every built ESM entry is bundled with esbuild (minified,
 * platform neutral, its shared chunks included), then gzipped. The run
 * fails when:
 * - an entry is over its gzipped budget;
 * - the core entry contains anything of the disposable list, the DNS
 *   check or a provider, which must stay in their own entries.
 *
 * Usage (after `yarn build`):
 *   node scripts/bundle-size.mjs
 */

import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { bold, cyan, green, red, yellow } from 'barva'

/** The repository root. */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The entries, their gzipped budget in bytes, and strings that must not
 * be in their bundle.
 * @type {{ name: string, file: string, budget: number,
 *   forbidden: string[] }[]}
 */
const ENTRIES = [
  {
    name: '@magikmaker/email-validator',
    file: 'dist/index.js',
    budget: 16 * 1024,
    forbidden: [
      // The disposable list: sample domains of it.
      'guerrillamail.com',
      'yopmail.com',
      'mailinator.com',
      '10minutemail',
      // The DNS entry and the providers.
      'cloudflare-dns.com',
      'api.kickbox.com',
    ],
  },
  {
    name: '/disposable',
    file: 'dist/disposable/index.js',
    budget: 80 * 1024,
    forbidden: ['cloudflare-dns.com', 'api.kickbox.com'],
  },
  {
    name: '/dns',
    file: 'dist/dns/index.js',
    budget: 16 * 1024,
    forbidden: ['guerrillamail.com', 'api.kickbox.com'],
  },
  {
    name: '/providers/kickbox',
    file: 'dist/providers/kickbox/index.js',
    budget: 4 * 1024,
    forbidden: ['guerrillamail.com', 'cloudflare-dns.com'],
  },
  {
    name: '/providers/mock',
    file: 'dist/providers/mock/index.js',
    budget: 2 * 1024,
    forbidden: ['guerrillamail.com', 'api.kickbox.com'],
  },
  {
    name: '/kickbox-csv',
    file: 'dist/kickbox-csv/index.js',
    budget: 6 * 1024,
    forbidden: ['guerrillamail.com', 'cloudflare-dns.com'],
  },
]

/**
 * Bytes as KB with one decimal.
 * @param {number} bytes - The size
 * @returns {string} e.g. `9.1 KB`
 */
function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * Bundle one entry the way a consumer's bundler would.
 * @param {string} file - The built entry, relative to the root
 * @returns {Promise<string>} The minified bundle
 */
async function bundle(file) {
  const result = await build({
    entryPoints: [path.join(ROOT, file)],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  })
  const output = result.outputFiles[0]
  if (!output) {
    throw new Error(`esbuild wrote nothing for ${file}`)
  }
  return output.text
}

/**
 * Measure every entry and check the rules.
 */
async function main() {
  const problems = []
  console.log(bold`Entry                         Minified    Gzipped    Budget`)
  for (const entry of ENTRIES) {
    const code = await bundle(entry.file)
    const gzipped = zlib.gzipSync(code, { level: 9 }).length
    const over = gzipped > entry.budget
    const line =
      `${entry.name.padEnd(28)} ${kb(code.length).padStart(9)} ` +
      `${kb(gzipped).padStart(10)} ${kb(entry.budget).padStart(9)}`
    console.log(over ? red`${line}` : line)
    if (over) {
      problems.push(`${entry.name} is over its budget`)
    }
    for (const needle of entry.forbidden) {
      if (code.includes(needle)) {
        problems.push(`${entry.name} contains "${needle}"`)
      }
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(red.bold`✗ ${problem}`)
    }
    process.exitCode = 1
    return
  }
  console.log(green`✓ Every entry is within budget and isolated`)
  console.log(
    cyan`The core bundle holds no disposable list, DNS or provider code.`
  )
}

main().catch((error) => {
  console.error(red.bold`Bundle size check failed: ${error.message}`)
  console.error(yellow`Run yarn build first.`)
  process.exitCode = 1
})
