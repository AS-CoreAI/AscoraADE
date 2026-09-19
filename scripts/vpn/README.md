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

For a VPN deployment that still requires the legacy client HMAC protocol,
its operator must supply `WANDROUNIK_CLIENT_SECRET` to the main process at
runtime. It is not a Vite renderer variable, is not loaded from a committed
file, and has no built-in fallback. A source build without this configuration
reports that VPN client authorization is not configured; the rest of the IDE
does not require it. Do not disable a production server's verification merely
to make an unconfigured client connect.

A static secret distributed to desktop clients can be extracted by users.
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
