#!/usr/bin/env node

/**
 * Give the CommonJS build its own type declarations. `tsc` writes one
 * `.d.ts` per source file next to the ESM output; this script copies
 * each to a `.d.cts` and points its relative imports at `.cjs`, so a
 * `require` consumer resolves CommonJS typed declarations and never
 * ESM ones.
 *
 * Usage:
 *   node scripts/build-types.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { green, red } from 'barva'

/** The build output. */
const DIST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist'
)

/**
 * Every `.d.ts` file under a directory.
 * @param {string} dir - The directory
 * @returns {string[]} Absolute paths
 */
function declarations(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return declarations(full)
    }
    return entry.name.endsWith('.d.ts') ? [full] : []
  })
}

/**
 * Copy one declaration to its `.d.cts` twin.
 * @param {string} file - A `.d.ts` file
 */
function twin(file) {
  const source = fs.readFileSync(file, 'utf8')
  const rewritten = source.replace(
    /(from\s+|import\(\s*)(['"])(\.{1,2}\/[^'"]+)\.js\2/g,
    (_match, lead, quote, specifier) =>
      `${lead}${quote}${specifier}.cjs${quote}`
  )
  fs.writeFileSync(file.replace(/\.d\.ts$/, '.d.cts'), rewritten)
}

try {
  const files = declarations(DIST)
  if (files.length === 0) {
    throw new Error('no declarations found; run tsc first')
  }
  files.forEach(twin)
  console.log(green`Wrote ${String(files.length)} .d.cts declarations`)
} catch (error) {
  console.error(red.bold`Failed to write the CommonJS types: ${error.message}`)
  process.exitCode = 1
}
