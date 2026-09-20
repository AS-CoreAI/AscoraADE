# Contributing to Ascora ADE

Read [LICENSE.md](LICENSE.md) and [LICENSING.md](LICENSING.md) first. This
project permits paid development work, internal business use, startup work,
and other Permitted Purposes under the ASCoreAI Source License 1.1. Selling
the IDE or its forks and providing paid or advertising-supported access to
them require ASCoreAI's written permission before each Version's 13-year
MIT transition. Paid and employer-sponsored contributions are welcome,
subject to the permissions below.

## Contribution permissions

By intentionally submitting a contribution for inclusion in Ascora ADE, you:

1. Confirm that you own it or have the permissions needed to submit it on
   these terms, including any necessary employer authorization.
2. License your contribution to recipients under LICENSE.md, including its
   irrevocable MIT grant effective 13 years after its first public availability
   under that license. Republishing it does not restart that period.
3. Also grant ASCoreAI a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable, sublicensable copyright license to use, reproduce, modify,
   distribute, publicly display, and commercially exploit your contribution,
   and distribute it under this or other license terms. This additional grant
   lets ASCoreAI make Restricted Offerings during the public restriction
   period. Your rights to the rest of Ascora ADE, including use for paid
   work, remain governed by LICENSE.md.
4. Grant ASCoreAI a corresponding patent license, to the extent you can grant
   it, for claims necessarily infringed by your contribution alone or its
   intended combination with the project.

You retain ownership and may independently license your own contribution.
ASCoreAI may not withdraw an already granted future MIT license. Material
clearly marked as not intended for inclusion is not a contribution under
these terms. Existing third-party code must retain its license and notices;
do not submit it as if you owned it.

## Development

Use Node.js 22.12 or newer, install dependencies with `npm ci`, and work from
the current `main` branch. Run `npm run typecheck` and the tests relevant to
your change. Include a concise problem description and validation in your
pull request. Never commit API keys, account exports, private keys, signing
certificates, local application data, or machine-specific agent settings.

For non-public security reports or licensing questions, use ASCoreAI's
contact channels at https://ascoreai.com rather than posting secrets in an
issue or pull request.
