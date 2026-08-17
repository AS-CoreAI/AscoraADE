# Bundled OmniRoute (zero-install sidecar)

Ascora ADE ships [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT) inside the
installer as a managed loopback gateway — the user installs nothing. Upstream is **never
forked**: the exact npm release pinned in `pin.json` is fetched, trimmed and bundled as an
artifact via electron-builder `extraResources` (`.build/omniroute` → `resources/omniroute`).

Latest verified Windows vendoring measurement for `omniroute@3.8.48`: **99,797 files,
1,169.1 MB uncompressed** after trimming (16,069 files / 401.9 MB removed). The final
installer is substantially smaller because electron-builder compresses the resource tree.

## Scripts

| Command | What it does |
|---|---|
| `npm run omniroute:vendor` | Fetch the pinned version → trim → assert → manifest → smoke test |
| `npm run omniroute:ensure` | Same, but no-op when `.build/omniroute` already matches the pin (used by `dist:*`) |
| `npm run omniroute:smoke` | Boot twice against one data dir and verify API + persistence exactly like production |
| `npm run omniroute:providers -- E:\\OmniRoute` | Regenerate the native 256-provider catalog and copy provider icons from an upstream source checkout |
| `npm run omniroute:update [-- x.y.z]` | Bump the pin (default: latest), re-vendor, smoke; **auto-reverts the pin on failure** |

## Update runbook

1. `npm run omniroute:update` (or with an explicit version). A failed smoke test reverts
   the pin automatically — upstream publishes are occasionally DOA (3.8.47 crashed on boot).
2. Skim the upstream release notes for **env/flag renames** — their defaults drift between
   patch releases (e.g. the live-WS port move, `OMNIROUTE_DISABLE_LIVE_WS` →
   `OMNIROUTE_ENABLE_LIVE_WS`). Every env we rely on is pinned in `env.mjs`.
3. When the upstream provider catalog changed, run `npm run omniroute:providers -- <checkout>`
   against the same source release and review the generated catalog/icon diff.
4. Update the version in `THIRD_PARTY_NOTICES.md`, add a `changelog.md` entry.
5. Commit `pin.json` (and `patches/` if touched).
6. Do a packaged sanity run before releasing (`npm run dist:win`, install, select OmniRoute).

## Env pins (single source: `env.mjs`)

`env.mjs` is the canonical env builder used by the smoke test; `src/main/omniroute/runner.ts`
must stay in sync with it (cross-referenced comments in both files).

| Var | Value | Why pinned |
|---|---|---|
| `ELECTRON_RUN_AS_NODE` | `1` | The sidecar runs through our own Electron binary as Node (no second runtime bundled) |
| `OMNIROUTE_SERVER_HOST` | `127.0.0.1` | Loopback only; upstream default is `0.0.0.0` |
| `PORT` | chosen by runner | Saved-port-first walk over `20128…20132` |
| `DATA_DIR` | `userData/omniroute/data` | Never their default `~/.omniroute` |
| `REQUIRE_API_KEY` | `false` | Loopback trust; hardening (Bearer) is a stage-2 item |
| `OMNIROUTE_SKIP_POSTINSTALL` | `1` | No install-time work at runtime |
| `OMNIROUTE_NO_UPDATE_NOTIFIER` | `1` | Updates ride ADE releases, not upstream's notifier |
| `OMNIROUTE_ENABLE_LIVE_WS` | `0` | We never show their dashboard; flip to `1` if an admin flow needs it |
| `STORAGE_ENCRYPTION_KEY` | persisted random hex | Stable key so their encrypted-at-rest provider keys survive restarts |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` | playwright is a regular dep upstream; no browser downloads ever |
| `NODE_ENV` | `production` | Prebuilt Next.js standalone server |

## What the trimmer removes (delete-only, never reshapes the tree)

- docs/locales for languages the app does not ship (keeps `en,ru,uk,de,fr,it,pl,zh,ko,ja,hi` of 42)
- tests/e2e/CI/examples inside the `omniroute` package, `*.map` everywhere, `prebuilds/`
- every `*.md` except `LICENSE*`/`NOTICE*`/`COPYING*` (license files MUST ship — attribution)
- whole feature packages we never use, at every `node_modules` level including their
  prebundled `dist/node_modules`: `@img` (sharp), `@ngrok` (tunnels), `onnxruntime-node`
  (ML compression), plus `better-sqlite3` and `@types` (an exact, count-checked
  compatibility shim enables `node:sqlite`, built into Electron 43's Node 24)
- every `*.node` binary EXCEPT the allowlist below
- esbuild platform packages are omitted with the rest of the optional graph, then the exact
  `@esbuild/win32-x64` and `@esbuild/linux-x64` versions matching the installed esbuild JS
  package are added explicitly (OmniRoute uses esbuild while booting its CLI)

**Native allowlist (`NATIVE_KEEP` in `vendor.mjs`):** upstream's TLS-fingerprint HTTP stack
(`koffi`, `wreq-js`) ships prebuilt, ABI-stable N-API binaries; the x64 variants for our two
build targets (win32, linux-gnu) are kept so anti-bot providers keep working, all other
platform variants are deleted. These are prebuilt artifacts — no rebuild step exists, so the
app's no-native-build-pipeline stance is preserved. Kept binaries are listed in
`VENDOR_MANIFEST.json.keptNative`.

**Hard assertions:** no `*.node` outside the allowlist; the `bin` entry from their
`package.json` exists. A tree that fails assertions or the smoke test never reaches a build
(`dist:*` runs `omniroute:ensure` first, and a failed smoke deletes the manifest).

**Zero-install compatibility shims:** `vendor.mjs` replaces upstream's literal `node`
worker launches with `process.execPath` (the Ascora Electron binary in Node mode) and repairs
Turbopack's broken `node:sqlite` external. Every replacement is exact/count-checked and listed
in `VENDOR_MANIFEST.json.builtinPatches`; upstream drift makes vendoring fail for review. The
restart smoke exists specifically to prevent regression to the write-once sql.js fallback.

## Smoke test triage

`smoke.mjs` prints the last 40 sidecar log lines on failure. Typical causes:
- **DOA upstream publish** — sidecar exits before health. Pin the previous version back.
- **Provider POST shape drift** — storage falls back to the `/api/settings` round-trip and
  logs a warning; update the payload variants in `smoke.mjs` and check `OmniRoutePanel`'s
  add-provider form against the new API.
- **Missing vendored tree** — run `npm run omniroute:vendor`.

## patches/

Emergency-only unified diffs (`*.patch`, applied in filename order by `vendor.mjs` via
`git apply`). Keep this directory empty in the normal course of business; a bump that keeps
patches must re-verify each one against the new release.
