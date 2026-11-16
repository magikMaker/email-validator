# Contributing

Thank you for helping. Issues and pull requests are welcome at
<https://github.com/magikMaker/email-validator>.

## Setup

```bash
corepack enable
yarn
yarn pre-commit
```

Use Yarn (4, with the `node_modules` linker), not npm. Development needs
Node 22 or newer; the published package runs on Node 20 and newer.

## Rules

- TypeScript, strict, never `any` (use `unknown` and narrow).
- JSDoc on every function, class and method; ESLint enforces it.
- Lines under 80 characters.
- Comments describe how things are, in the present tense.
- No em or en dashes in documentation, messages or other text people
  read; use a comma, a colon, parentheses or a new sentence.
- Zero runtime dependencies. The core must stay browser safe and small:
  no Node built-ins anywhere in `src`, only `fetch`, `URL`, Web Crypto
  and other web platform APIs.
- Unit tests sit next to the file under test (`foo.ts`, `foo.test.ts`).
- Add an entry under `[Unreleased]` in `CHANGELOG.md`.
- `yarn pre-commit` passes with no errors and no warnings.

## A false positive on the disposable list

Add the domain to `lists/disposable-allowlist.txt` with a short note
why, run `yarn update-disposable-domains`, and report it upstream at
<https://github.com/disposable-email-domains/disposable-email-domains>
as well.

## A new mail provider or domain

Add it to `src/data/email-providers.json`; no code change is needed
unless the provider publishes local part rules of its own. Add a test.

## A new verification provider

1. Create `src/providers/<name>/index.ts` exporting a factory, e.g.
   `zerobounce({ apiKey, fetch?, ... })`, that returns a
   `VerifierProvider`. Follow `src/providers/kickbox/index.ts`:
   - map every answer onto the eight statuses and nothing else;
   - pass the `signal` to `fetch`;
   - throw `VerifierError` without the address or the key in the
     message, `retryable` for rate limits and outages;
   - remove address fields from `raw`;
   - no fail open or policy logic: the validator owns those.
2. Record real answers (with made up addresses) in a fixtures file and
   test the mapping, errors, retries and abort with an injected `fetch`.
3. Add the entry to `vite.config.ts`, the `exports` map in
   `package.json`, `scripts/check-exports.mjs` and
   `scripts/bundle-size.mjs` (with a budget).
4. Document it in the README.
