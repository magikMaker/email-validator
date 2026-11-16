#!/usr/bin/env node

/**
 * Create the GitHub release of the version in package.json, with its
 * CHANGELOG.md section as the notes. Run it after the version is
 * published to npm and its tag is pushed; it never pushes, tags or
 * publishes by itself.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/release-github.mjs
 *
 * The token needs permission to create releases on the repository.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bold, cyan, green, red } from 'barva'

/** The repository root. */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The owner and name of the `origin` remote on GitHub.
 * @returns {{ owner: string, repo: string }} The repository
 */
function repoInfo() {
  const url = execSync('git remote get-url origin', { cwd: ROOT })
    .toString()
    .trim()
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (!match) {
    throw new Error(`origin is not a GitHub remote: ${url}`)
  }
  return { owner: match[1], repo: match[2] }
}

/**
 * The CHANGELOG.md section of a version, without its heading.
 * @param {string} version - e.g. `0.1.0`
 * @returns {string} The notes
 */
function notesOf(version) {
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf(`## [${version}]`)
  if (start < 0) {
    throw new Error(`CHANGELOG.md has no section for ${version}`)
  }
  const body = changelog.slice(changelog.indexOf('\n', start) + 1)
  const end = body.search(/\n-{10,}\n|\n<a name=|\n## \[/)
  return (end < 0 ? body : body.slice(0, end)).trim()
}

/**
 * Create the release.
 */
async function main() {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN is not set')
  }
  const { version } = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  )
  const { owner, repo } = repoInfo()
  const tag = `v${version}`
  console.log(cyan`Creating release ${tag} on ${owner}/${repo}`)
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body: notesOf(version),
        draft: false,
        prerelease: false,
      }),
    }
  )
  if (!response.ok) {
    throw new Error(
      `GitHub answered ${response.status}: ${await response.text()}`
    )
  }
  const release = await response.json()
  console.log(green.bold`Released ${tag}: ${release.html_url}`)
}

main().catch((error) => {
  console.error(red.bold`Release failed: ${error.message}`)
  console.error(bold`Nothing was created.`)
  process.exitCode = 1
})
