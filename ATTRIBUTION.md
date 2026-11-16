# Attribution

This package bundles data maintained by others. Thank you.

## Disposable email domains

`src/data/disposable-domains.ts` is generated from the blocklist of
[disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains),
released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
(public domain dedication). No attribution is required; it is given
anyway.

Domains in `lists/disposable-allowlist.txt` and every domain of the
provider table (`src/data/email-providers.json`) are left out.

### Optional broad source

`scripts/update-disposable-domains.mjs --broad` also merges the list of
[disposable/disposable-email-domains](https://github.com/disposable/disposable-email-domains),
released under the MIT License, Copyright (c) 2017 Andrei Simionescu. It
is not part of the published package. A build that ships it must keep
that copyright notice and the MIT permission notice.

## Top level domains

`src/data/tlds.ts` is generated from the list of top level domains the
[Internet Assigned Numbers Authority (IANA)](https://www.iana.org/)
publishes at <https://data.iana.org/TLD/tlds-alpha-by-domain.txt>.

## Kickbox

Kickbox is a trademark of its owner. This package is not affiliated with
or endorsed by Kickbox; the provider uses its public
[single verification API](https://docs.kickbox.com/docs/single-verification-api).
