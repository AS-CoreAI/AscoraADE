# VPN components and credentials

Ascora ADE uses the public Wandrounik client API and local WireGuard/OpenVPN
executables. The public API address, protocol, and official download URLs are
configuration information, not administrative credentials. Third-party
programs retain their licenses; see ../../THIRD_PARTY_NOTICES.md.

## Runtime data

Account sessions and VPN profiles are created under Electron's
`app.getPath('userData')/vpn`, outside the source tree. Account tokens and
email addresses are persisted through Electron `safeStorage` when encryption
is available; otherwise token persistence is disabled. WireGuard private keys
are generated on the user's machine. Never copy this runtime directory into
Git, a release archive, a bug report, or a test fixture.

## Legacy client proof

The server requires the legacy HMAC only for `/api/client/connect`,
`/api/client/disconnect`, and `/api/client/traffic`. Login, registration,
token refresh, profile and server discovery must work without this credential.

Operators can supply `WANDROUNIK_CLIENT_SECRET` at runtime, or run
`npm run vpn:auth` with that variable (or `WANDROUNIK_CLIENT_AUTH_FILE` pointing
to a private JSON file containing `clientSecret`) before packaging. This stages
`.build/vpn-client-auth.json`, which is ignored by Git and loaded by development
builds. Windows installers include it at `resources/vpn/client-auth.json`.
`dist:win` validates this resource before building, so a release cannot silently
ship without VPN client authorization. The runtime environment variable takes
precedence, allowing operators to rotate the credential. Never put its value in
source code, Vite renderer variables, logs or test fixtures. Do not disable the
server's proof verification to make an unconfigured client connect.

A release resource is not a secret vault: a static credential distributed to
desktop clients can be extracted by users, just as in the legacy desktop client.
It cannot establish that a request came from an official, unmodified binary.
Server authorization, subscription checks, quotas, and abuse controls must
not depend solely on this proof or on a client-supplied machine identifier.

Operators migrating an existing deployment must retire any previously
distributed shared key and coordinate compatible client/server updates.
Moving the same key to an environment variable or deleting it from the latest
commit does not revoke keys embedded in older installers or Git history.

## Publication checks

Run Gitleaks with the repository's `.gitleaks.toml` against all published Git
refs. The custom rules detect the legacy VPN proof secret and Unsloth API keys
in addition to the default rules. Audit Actions logs and release attachments
as well as the current files. Never publish a secret-containing history merely
because a newer commit removes the value.

Use `node --test scripts/tests/vpn-client-proof.cjs` to verify missing-secret
handling and compatibility of configured clients with the existing protocol.
