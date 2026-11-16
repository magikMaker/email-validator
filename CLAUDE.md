# CLAUDE.md

Guidance for Claude Code in this repository.

## Project

`@magikmaker/email-validator`, a public npm package (MIT). It extracts
the email validation that lived, copied, in RedirMe, Mail818 and
Maestro, so every project uses one maintained library.

- **Validation**: everything checked without contacting the mailbox
  (syntax, TLD, provider rules, typos, disposable domains, role accounts,
  the optional DNS check). The core.
- **Verification**: asking a third party whether the mailbox exists,
  through a pluggable `VerifierProvider` (Kickbox first). The core owns
  timeouts, abort, cache, budget, fail open and policy for every
  provider; a provider only maps its API onto the eight statuses.

## Layout

- `src/index.ts`: core entry (browser safe, small). `src/core/*`.
- `src/disposable`, `src/dns`, `src/providers/kickbox`,
  `src/providers/mock`, `src/kickbox-csv`: one entry each.
- `src/data/`: generated lists (`tlds.ts`, `disposable-domains.ts`) and
  the provider table (`email-providers.json`, edited by hand).
- `lists/disposable-allowlist.txt`: false positives, always win.
- `scripts/`: list updaters, type post-processing, export and size
  checks, the GitHub release script. JavaScript (`.mjs`), barva output.

## Rules

- Yarn only (4, `nodeLinker: node-modules`); never npm.
- TypeScript strict, never `any`; JSDoc on everything; lines under 80.
- Zero runtime dependencies; no Node built-ins in `src`; Web Crypto via
  the global `crypto`, never `import crypto`.
- The core entry must never import `src/data/disposable-domains.ts`, the
  DNS check or a provider. `yarn bundle-size` enforces it.
- Comments in the present tense. No em or en dashes in docs or strings.
- Tests next to the file under test; vitest.
- Add a `CHANGELOG.md` entry under `[Unreleased]` for every change.
- Run `yarn pre-commit` (lint, typecheck, test, build, export check,
  bundle size) and fix every error and warning before committing.
- Commit locally when a task is done. **Never push, publish, tag or
  create releases** unless the owner asks in the current request. Never
  bump the version on your own.
- Do not edit the generated files in `src/data/` by hand; run the
  scripts.
