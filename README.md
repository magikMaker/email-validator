# Email Validator

Email address validation that catches what a regex lets through, with
pluggable mailbox verification when you need more.

[![npm version](https://img.shields.io/npm/v/@magikmaker/email-validator.svg)](https://www.npmjs.com/package/@magikmaker/email-validator)
[![CI](https://github.com/magikMaker/email-validator/actions/workflows/ci.yml/badge.svg)](https://github.com/magikMaker/email-validator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🧪 **Stricter than a regex**: one `@`, label rules, length limits, no
  IP literals, reserved domains (`example.com`, `.test`, `.local`)
- 🌍 **Real TLDs only**: checked against the IANA root zone list, IDN
  domains (`пример.рф`) included
- 📮 **Provider rules**: Gmail, Outlook, Proton, Tuta and iCloud publish
  what a local part may look like; `anna@gmail.com` cannot exist
- ✍️ **Typo hints**: `gmial.com`, `hotmial.com`, and a known provider on
  the wrong TLD (`gmail.de` to `gmail.com`)
- 🗑️ **Disposable domains**: about 10,000 throwaway services, refreshed
  weekly, in their own entry so browser bundles stay small
- 🔑 **Canonical keys**: `Anna.Lund+promo@googlemail.com` and
  `annalund@gmail.com` are one mailbox
- 🛰️ **DNS check**: MX, A and AAAA over HTTPS, null MX aware, fail open
- 🔌 **Pluggable verification**: Kickbox today, any provider tomorrow,
  with timeouts, abort, caching and fail open handled once, in the core
- 📦 **Zero dependencies**: runs unchanged on Cloudflare Workers, Node 20+,
  Deno, Bun and the browser; ESM and CommonJS, fully typed

## Validation and verification

Two words, two different jobs:

- **Validation** is everything that can be checked without contacting the
  mailbox: syntax, whether the TLD exists, the provider's local part
  rules, typos, disposable domains, role accounts and, optionally, a DNS
  lookup for mail servers. This is the core of the library. It is free,
  fast and private: the address never leaves your code (the DNS check
  sends only the domain).
- **Verification** asks a third party whether the mailbox itself exists.
  It costs money per address, takes a second or two, and sends the
  address to the provider. This library does not do it by itself: it
  defines a small provider interface, ships a Kickbox provider and a mock,
  and runs any provider through the same timeout, cache and policy layer.

## Installation

```bash
# npm
npm install @magikmaker/email-validator

# yarn
yarn add @magikmaker/email-validator

# pnpm
pnpm add @magikmaker/email-validator

# bun
bun add @magikmaker/email-validator
```

## Quick start

### In a form (browser, core only)

The core entry is about 11 KB gzipped and has no disposable list, no DNS
and no provider code.

```ts
import { checkTypedEmail } from '@magikmaker/email-validator'

const problem = checkTypedEmail(input.value, { confirmTypo: keepAsTyped })
if (problem?.reason === 'likely_typo') {
  showHint(problem.message) // "Did you mean anna@gmail.com?"
} else if (problem) {
  showError(problem.message)
}
```

### On a server (Node)

```ts
import { createValidator } from '@magikmaker/email-validator'
import { isDisposableDomain } from '@magikmaker/email-validator/disposable'
import { createDomainCheck } from '@magikmaker/email-validator/dns'

const validator = createValidator({
  disposable: isDisposableDomain,
  dns: createDomainCheck(),
})

const result = await validator.validate('anna@gmial.com')
result.verdict // 'reject': gmial.com is a typo squat on the list
result.findings
// [
//   { code: 'domain_typo_suspected', verdict: 'review',
//     message: 'Did you mean anna@gmail.com?',
//     suggestion: 'anna@gmail.com' },
//   { code: 'disposable_domain', verdict: 'reject',
//     message: 'gmial.com is a known disposable email provider' },
// ]
```

### On Cloudflare Workers, with Kickbox and a KV cache

```ts
import { createValidator } from '@magikmaker/email-validator'
import type { CachedResult } from '@magikmaker/email-validator'
import { isDisposableDomain } from '@magikmaker/email-validator/disposable'
import { createDomainCheck } from '@magikmaker/email-validator/dns'
import { kickbox } from '@magikmaker/email-validator/providers/kickbox'

// One per isolate: its memory cache survives between requests.
const dns = createDomainCheck()

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { email } = await request.json<{ email: string }>()
    const validator = createValidator({
      disposable: isDisposableDomain,
      dns,
      provider: kickbox({ apiKey: env.KICKBOX_API_KEY }),
      policy: 'gate',
      cache: {
        get: (key) =>
          env.CACHE_KV.get<CachedResult>(`verifier:${key}`, 'json'),
        set: (key, result) =>
          env.CACHE_KV.put(`verifier:${key}`, JSON.stringify(result), {
            expirationTtl: 30 * 24 * 60 * 60,
          }),
      },
    })
    const result = await validator.validate(email)
    if (result.verdict === 'reject') {
      return Response.json({ error: result.findings }, { status: 400 })
    }
    return Response.json({ ok: true })
  },
}
```

The cache key is a SHA-256 hash of the address, so neither KV nor D1
ever holds the address itself.

## Entry points

| Import | What | Gzipped |
| --- | --- | --- |
| `@magikmaker/email-validator` | Core: checks, chain, validator, policies, cache | ~11 KB |
| `@magikmaker/email-validator/disposable` | The disposable domain list and checks | ~63 KB |
| `@magikmaker/email-validator/dns` | DNS over HTTPS domain check | ~8 KB with the core parts it uses |
| `@magikmaker/email-validator/providers/kickbox` | Kickbox provider | ~1.4 KB |
| `@magikmaker/email-validator/providers/mock` | Mock provider for tests and dry runs | ~0.6 KB |
| `@magikmaker/email-validator/kickbox-csv` | Kickbox bulk export parser | ~1.5 KB |

Sizes are minified and gzipped, measured by `yarn bundle-size`, which
also fails the build when the core bundle picks up anything of the
disposable list, the DNS check or a provider.

### `@magikmaker/email-validator`

Pure checks, no I/O:

- `checkEmailShape(email)`: `'syntax'`, `'reserved_domain'` or `null`.
- `isKnownTld(domain)`, `hasValidTld(hostname)`, `IANA_TLDS`,
  `toAsciiDomain(domain)` (IDN to punycode through the platform `URL`
  parser, no dependency).
- `checkProviderRules(email)`: the local part rules of Gmail, Microsoft,
  Proton, Tuta and iCloud; `{ provider, verdict, message }` or `null`.
- `canonicalEmailKey(email)`: one key per mailbox for de-duplication
  (Gmail dots and `googlemail.com`, Proton dots, hyphens and underscores,
  plus tags everywhere but Tuta).
- `suggestEmailDomain(email)`: the full suggested address or `null`,
  including the wrong TLD rule (`gmail.de` to `gmail.com`).
- `isRoleAccount(email)`, `ROLE_ACCOUNT_NAMES`.
- `EMAIL_PROVIDERS`, `providerOfDomain`, `providerOfEmail`,
  `wrongTldSuggestion`: the provider table.
- `validateEmailAddress(email, { disposable? })`: every local finding at
  once, `{ normalized, canonical, verdict, findings }`.
- `checkTypedEmail(email, { confirmTypo?, disposable? })`: the first
  refusal for a form field, with `EMAIL_REFUSAL_MESSAGES`.

The validator and its plug points:

- `createValidator(options)` returns `{ validate(address, { signal? }) }`.
- `gatePolicy`, `reviewPolicy`, `policyOf`.
- `createMemoryCache()`, `isStale()`, `emailHash()`.
- `VerifierError`, `VERIFIER_STATUSES`, `isVerifierStatus()`, and the
  `VerifierProvider` type.

### `@magikmaker/email-validator/disposable`

- `isDisposableDomain(domain)`: matches the domain or any parent, so
  `mail.yopmail.com` is disposable too.
- `isDisposableEmail(email)`, `DISPOSABLE_DOMAINS`.
- `createDisposableCheck({ allow?, block? })`: your own additions; `allow`
  always wins.

Plug it into the core with the `disposable` option of
`validateEmailAddress`, `checkTypedEmail` or `createValidator`.

### `@magikmaker/email-validator/dns`

- `createDomainCheck(options)`: a check function for the `dns` option.
  A domain that does not exist, publishes the null MX `0 .` (RFC 7505),
  or has neither MX nor A nor AAAA records is `undeliverable`. Anything
  unclear (SERVFAIL, timeout, network error) is `ok`: it fails open and
  never caches that.
- Options: `fetch`, `endpoint` (Cloudflare's JSON API by default;
  `https://dns.google/resolve` works too), `timeoutMs` (2000), `cache`
  (your `{ get, set }` with a TTL: `ok` for 7 days, `undeliverable` for 6
  hours), `memory` (500 entries for 5 minutes, or `false`), `onError`.
- `checkEmailDomain(domain, options)` for a one off,
  `resolveDomainVerdict(domain, options)` without any cache.

### `@magikmaker/email-validator/providers/kickbox`

`kickbox({ apiKey, timeoutMs?, maxAttempts?, fetch?, apiBase? })`. It
calls the single verification API with `fetch`, so it runs on Workers
(the official Kickbox client is Node only). The defaults suit a request
path: Kickbox gets 3 seconds, one attempt. For a batch run ask more:

```ts
kickbox({ apiKey, timeoutMs: 6000, maxAttempts: 3 })
// with createValidator({ timeoutMs: 30_000, ... })
```

The `raw` answer drops `email` and `user` and keeps only the domain of
Kickbox's `did_you_mean`, so it can be stored. Errors never name the
address or the key.

### `@magikmaker/email-validator/providers/mock`

`mock({ statuses?, fallback?, failure?, delayMs?, name? })`: answers from
a map, then from a `+status` tag (`anna+catch_all@acme.com`), then the
fallback. `failure` and `delayMs` let you test the fail open paths.

### `@magikmaker/email-validator/kickbox-csv`

`parseKickboxCsv(csv, { offset?, limit? })` reads Kickbox's bulk export
into `{ email, status, raw }` entries with the same mapping as the API,
so you can fill your cache from a list you verified in Kickbox's web
app. Store each with `emailHash(entry.email)` as the key.

## Findings and verdicts

Every finding has a `code`, a `verdict` and a `message`. The overall
verdict is `reject` when any finding rejects, else `review` when any asks
for it, else `send`.

| Code | Verdict | When |
| --- | --- | --- |
| `syntax_invalid` | reject | Not a well formed address; the chain stops |
| `reserved_domain` | reject | `example.com`, `.test`, `.local`, ... |
| `tld_unknown` | reject | The TLD is not on the IANA list |
| `domain_typo_suspected` | review | Looks like a typo; has `suggestion` |
| `provider_rules_invalid` | reject | Cannot exist at its provider; has `provider` |
| `provider_rules_review` | review | Unusual at its provider (iCloud length) |
| `disposable_domain` | reject | On the disposable list |
| `role_account` | review | `info@`, `admin@`, `no-reply@`, ... |
| `domain_undeliverable` | reject | DNS: no such domain or no mail server |
| `mailbox_*` | policy | The verifier's status; has `status` |
| `verifier_failed` | policy | Error, timeout or abort at the provider |
| `verifier_skipped` | policy | Your `budget` said no |

`findingReasonCode(finding)` gives `provider_rules_invalid:gmail` style
codes for logs and admin screens.

## Policies

A policy turns a verifier status, or no answer (`null`), into a verdict.

| Status | `gate` | `review` |
| --- | --- | --- |
| `valid` | send | send |
| `invalid` | reject | reject |
| `disposable` | reject | reject |
| `spamtrap` | reject | reject |
| `abuse` | reject | reject |
| `catch_all` | send | review |
| `unknown` | send | review |
| `role` | send | review |
| no answer | send | review |

- `gate` (the default) is for request paths such as a signup or a
  public form: refuse only what cannot take mail, and fail open, so a
  provider outage never blocks a person.
- `review` is for onboarding and list cleaning, where a person looks at
  everything nobody vouched for.
- A custom policy is a function:

```ts
createValidator({
  provider,
  policy: (status) => (status === 'valid' ? 'send' : 'review'),
})
```

## The validator

`validate(address)` runs, in order, stopping at the first reject:

1. the local chain (with your `disposable` check);
2. `dns`, when given;
3. the cache, when given: a fresh answer (30 days by default,
   `staleAfterMs`) is used without a call;
4. `budget`, when given: return `false` to skip the paid call (a daily
   cap, for example); a budget that throws counts as `false`;
5. the provider, within `timeoutMs` (5 seconds by default) and your
   `signal`; the answer is cached;
6. the policy.

It never throws. Failures of the DNS check, the cache, the budget and
the provider become findings or are absorbed, and are handed to
`onError(stage, error)` if you want to log them. `result.verification`
tells what happened (`result` from `cache` or `call`, `failed`,
`skipped`) and `result.domainCheck` what DNS said.

## Cache

```ts
interface VerifierCache {
  get(key: string): Promise<CachedResult | null>
  set(key: string, result: CachedResult): Promise<void>
}
```

The key is `emailHash(address)`: SHA-256 hex of the trimmed, lowercased
address, computed with Web Crypto (`crypto.subtle`), so it works the same
on Workers, Node 20+ and in the browser. Staleness is checked by the
validator, so your store may return old rows. `createMemoryCache()` is
an in-memory one for tests and scripts. A D1 version:

```ts
const cache: VerifierCache = {
  async get(key) {
    const row = await env.DB.prepare(
      'SELECT result FROM verifier_cache WHERE key = ?'
    ).bind(key).first<{ result: string }>()
    return row ? (JSON.parse(row.result) as CachedResult) : null
  },
  async set(key, result) {
    await env.DB.prepare(
      'INSERT INTO verifier_cache (key, result) VALUES (?, ?) ' +
        'ON CONFLICT (key) DO UPDATE SET result = excluded.result'
    ).bind(key, JSON.stringify(result)).run()
  },
}
```

## Writing a provider

A provider is an object with a `name` and a `verify` method that maps
the provider's answer onto the eight shared statuses: `valid`,
`invalid`, `catch_all`, `unknown`, `disposable`, `role`, `spamtrap`,
`abuse`.

```ts
import { VerifierError } from '@magikmaker/email-validator'
import type { VerifierProvider } from '@magikmaker/email-validator'

/** A sketch of a ZeroBounce provider. */
export function zerobounce(options: { apiKey: string }): VerifierProvider {
  return {
    name: 'zerobounce',
    async verify(address, { signal } = {}) {
      const query = new URLSearchParams({
        api_key: options.apiKey,
        email: address,
      })
      let response: Response
      try {
        response = await fetch(
          `https://api.zerobounce.net/v2/validate?${query}`,
          { signal }
        )
      } catch {
        throw new VerifierError('ZeroBounce could not be reached', {
          retryable: true,
        })
      }
      if (!response.ok) {
        throw new VerifierError(`ZeroBounce answered ${response.status}`)
      }
      const body = (await response.json()) as {
        status: string
        sub_status: string
      }
      const status =
        body.sub_status === 'disposable' ? 'disposable'
        : body.sub_status === 'role_based' ? 'role'
        : body.status === 'valid' ? 'valid'
        : body.status === 'invalid' ? 'invalid'
        : body.status === 'catch-all' ? 'catch_all'
        : body.status === 'spamtrap' ? 'spamtrap'
        : body.status === 'abuse' ? 'abuse'
        : 'unknown'
      return {
        status,
        raw: { provider: 'zerobounce', status: body.status,
          subStatus: body.sub_status },
      }
    },
  }
}
```

The rules for a provider:

- **Map, do not decide.** Return a status; the policy decides what it
  means. Do not implement fail open or a timeout of your own beyond what
  the API needs: the validator does that for every provider alike.
- **Honour `signal`.** Pass it to `fetch`, so a call nobody waits for
  stops.
- **Throw `VerifierError`** when there is no usable answer, and never put
  the address or the API key in its message. Set `retryable` for rate
  limits and outages.
- **Strip the address from `raw`.** It may be stored next to a hash
  whose whole point is not to store the address.
- Use `fetch` only, no Node built-ins, so the provider runs on Workers.

See [CONTRIBUTING.md](CONTRIBUTING.md) to add a provider to this package.

## Lists and updates

- **TLDs**: the IANA root zone list,
  `https://data.iana.org/TLD/tlds-alpha-by-domain.txt`.
- **Disposable domains**: the conservative community list
  [disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains)
  (CC0). `node scripts/update-disposable-domains.mjs --broad` also
  merges the much larger
  [disposable/disposable-email-domains](https://github.com/disposable/disposable-email-domains)
  list (MIT), which catches more and also blocks more real people; it is
  not part of the published default.
- **Allowlist**: `lists/disposable-allowlist.txt` and every domain of
  the provider table always win over any source.

A weekly GitHub Actions workflow regenerates both lists, runs the tests
and opens a pull request when something changed. Nothing is published
automatically. Run `yarn update-lists` to refresh by hand. The npm
packages that bundle frozen copies of such lists go stale; this package
does not depend on any of them.

## Limitations

- **No SMTP probing.** The library never connects to a mail server to
  ask about a mailbox (it is slow, often blocked, and gets your IP
  listed). Use a verification provider for that.
- **Validation is not verification.** A valid, deliverable looking
  address may still not exist. Only a provider (or a confirmation email)
  can tell.
- **Lists lag.** New throwaway services appear daily; the disposable list
  catches the known ones.
- **Provider rules change.** The rules reflect what the providers publish
  today; report a false rejection as an issue.
- **DNS fails open.** An unclear DNS answer passes, on purpose.
- **Node 20 or newer** for the global Web Crypto API.

## Development

```bash
yarn                 # install (Yarn 4, node_modules linker)
yarn test            # vitest
yarn lint            # eslint, JSDoc and line length included
yarn typecheck       # tsc
yarn build           # vite library build and type declarations
yarn check-exports   # load every entry with import and require
yarn bundle-size     # sizes and entry isolation
yarn pre-commit      # all of the above
yarn update-lists    # refresh the TLD and disposable lists
```

## Releasing

1. Move the `[Unreleased]` entries of `CHANGELOG.md` under the new
   version and date.
2. `yarn patch`, `yarn minor` or `yarn major` (runs `yarn pre-commit`,
   then bumps `package.json`).
3. Commit, tag `vX.Y.Z`, push the commit and the tag.
4. `yarn npm publish --access public`.
5. `GITHUB_TOKEN=... yarn release` creates the GitHub release from the
   changelog section.

## License

[MIT](LICENSE). The bundled lists come from third parties; see
[ATTRIBUTION.md](ATTRIBUTION.md).
