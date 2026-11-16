# Changelog
Document all changes to this project below using the following headings:

- Added
  for new features.
- Changed
  for changes in existing functionality.
- Deprecated
  for soon-to-be removed features.
- Fixed
  for any bug fixes.
- Removed
  for now removed features.
- Security
  in case of vulnerabilities.

The format is based on [Keep a Changelog](https://keepachangelog.com/)
and this project adheres to [Semantic Versioning](https://semver.org/).

Make sure to add a link to the Pull Request and/or issue number (if applicable)

-------------------------------------------------------------------------------

<a name="unreleased"></a>
## [Unreleased]

-------------------------------------------------------------------------------

<a name="0.1.0"></a>
## [0.1.0] - 2026-11-17

### Added
- Core entry: `checkEmailShape`, `isKnownTld`, `hasValidTld`,
  `toAsciiDomain`, `checkProviderRules` with the provider table (Gmail,
  Microsoft, Proton, Tuta, iCloud, Yahoo, GMX, Zoho, Fastmail, Yandex,
  Mail.ru, Dutch ISPs), `canonicalEmailKey`, `suggestEmailDomain` with
  the wrong TLD rule, `isRoleAccount`, `validateEmailAddress` with
  reason codes and verdicts, and `checkTypedEmail` for form fields.
- `createValidator`: local checks, then the optional DNS check, then the
  optional verification provider, with timeouts, abort, a call budget,
  a result cache keyed by the address hash (30 day staleness) and fail
  open handled once for every provider.
- Policies `gate` and `review`, and custom policy functions.
- The `VerifierProvider` interface, `VerifierError` and the eight shared
  statuses.
- `/disposable` entry: about 10,000 disposable domains from
  disposable-email-domains (CC0), `isDisposableDomain`,
  `createDisposableCheck` with your own allow and block lists.
- `/dns` entry: DNS over HTTPS domain check (MX, A, AAAA, null MX), fail
  open, memory cache and a pluggable cache.
- `/providers/kickbox` entry: the Kickbox provider over `fetch`, address
  free `raw` answers, retries with backoff.
- `/providers/mock` entry: a deterministic provider for tests and dry
  runs.
- `/kickbox-csv` entry: the Kickbox bulk export parser.
- Scripts to regenerate the IANA TLD list and the disposable list (with
  an allowlist and an optional broad source), and a weekly workflow that
  opens a pull request when they change.
- A bundle size check that keeps the disposable list, the DNS check and
  the providers out of the core bundle.
