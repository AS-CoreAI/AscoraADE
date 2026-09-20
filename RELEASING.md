# Publishing Ascora ADE

The canonical source and release repository is **AS-CoreAI/AscoraADE**:
https://github.com/AS-CoreAI/AscoraADE/releases

Do not publish new releases to `AS-CoreAI/Ascora-ADE`. That repository retains
historical downloads for installed clients and existing links. Its version
directories and Git history are not part of this source repository.

## Prepare and build

1. Update the application version and its section in `changelog.md`. Review
   `LICENSE.md`, `LICENSING.md`, and third-party notices for the new version.
2. Commit and push the reviewed source. Build from that same commit on Windows
   and Linux (WSL is supported for Linux). Vendor the platform-specific OmniRoute
   runtime and, on Windows, the VPN runtimes using the existing package scripts.
3. Run `npm run typecheck`, relevant regression checks, and packaged startup
   checks. Build with `npm run dist:win -- --publish never` on Windows and
   `npm run dist:linux -- --publish never` inside Linux/WSL. Supply the release
   signing configuration separately; never commit credentials or signing keys.
4. Collect the Windows Setup and Portable executables plus Linux `.deb`, `.rpm`,
   `.pacman`, and `.AppImage` packages in a staging directory **outside Git**.
   Generate `SHA256SUMS.txt` over the final, signed packages, using their release
   asset filenames without local directory prefixes. Verify every entry.

## Publish

Create a version tag at the exact reviewed source commit and push that tag
explicitly. Avoid bulk/mirror pushes from checkouts with private archive refs.
Copy only the corresponding version's changelog into a UTF-8 release-notes file;
do not include `Unreleased` changes that are absent from the binaries.

For example, after replacing `vX.Y.Z`, paths, and the title with real values:

```sh
gh release create vX.Y.Z --repo AS-CoreAI/AscoraADE --verify-tag --draft \
  --title 'Ascora ADE X.Y.Z' --notes-file /path/to/RELEASE_NOTES.md
gh release upload vX.Y.Z --repo AS-CoreAI/AscoraADE /path/to/staging/*
gh release view vX.Y.Z --repo AS-CoreAI/AscoraADE
```

Keep only the six intended packages and `SHA256SUMS.txt` in that staging directory.
Check asset names, sizes, SHA-256 digests, signatures, and downloadability before
publishing. Do not overwrite files in an existing published release.

```sh
gh release edit vX.Y.Z --repo AS-CoreAI/AscoraADE --draft=false --latest
```

`electron-builder.yml` also targets `AS-CoreAI/AscoraADE` and creates drafts when
publication is explicitly enabled. No source or version directories are uploaded
as release attachments; GitHub generates source archives from the tag itself.

Finally, update the website's `/control` release feed with the new version,
release notes, date, and the new repository's per-platform asset URLs. Check
`https://ade.ascoreai.com/api/releases/latest`, the website downloads, and the
application's GitHub fallback. GitHub publication alone does not update that feed.

## Historical releases

Versions `v1.0.0` through `v1.3.1` were migrated from `AS-CoreAI/Ascora-ADE`.
Their original publication dates are recorded in their descriptions; GitHub's
publication timestamps and download counters start again at migration. Asset
bytes and checksum files are preserved. Tags refer to the corresponding cleaned
public source history, not the distribution repository's binary directories.
These source archives are not a claim of byte-for-byte reproducible builds.
The migration does not change existing license grants for older installers.

The migration copied **9 releases and 55 attachments** (6,224,467,568 bytes).
Each file's name, size, label, and SHA-256 digest was verified against the original
before publication. The [one-time transfer run](https://github.com/AS-CoreAI/AscoraADE/actions/runs/35477686538)
completed successfully; its workflow was disabled and removed afterward.
