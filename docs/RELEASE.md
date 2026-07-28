# Xixi Desktop Release Guide

Core Lite 4.9 establishes the first production packaging and release contract.
The application version is `0.1.0`, the stable application identifier is
`com.hoyo.xixi.desktop`, and the product name is `Xixi Desktop`.

Do not change the application identifier after the first public installation.
Changing it creates a different application identity and breaks in-place upgrades.

## Release targets

- Windows: signed NSIS installer, x64 and arm64 payloads, GitHub update metadata.
- macOS: signed and notarized universal DMG plus ZIP update payload.
- Linux: AppImage plus GitHub update metadata.

The portable/source ZIP is not an automatic-update target.

## Local unsigned packaging

Unsigned builds are for local verification only.

```powershell
npm ci
npm run check:full
npm run release:bootstrap
npm run release:package:win
```

Artifacts are written under `release/win32`.

The release bootstrap installs pinned packaging dependencies without changing
`package.json` or `package-lock.json`. `run-electron-builder.mjs` temporarily
adds `electron-updater` to the effective application dependencies while the
package is assembled, then restores the original `package.json` in `finally`.

## Formal release sequence

1. Update `package.json` and both version fields in `package-lock.json`.
2. Update `CHANGELOG.md`.
3. Run `npm run check:full` locally.
4. Commit with a clean working tree.
5. Create and push an annotated tag matching the version exactly:

```powershell
git tag -a v0.1.0 -m "Xixi Desktop v0.1.0"
git push origin v0.1.0
```

6. The `Release` workflow validates the tag, runs Core Lite gates, builds all
   platforms, verifies signatures, creates checksums and a release manifest,
   and publishes one GitHub Release.
7. Only install artifacts from the GitHub Release that includes
   `release-manifest.json` and `SHA256SUMS.txt`.

## Required GitHub Actions secrets

Windows:

- `WINDOWS_CSC_LINK`: base64 certificate or supported certificate URL.
- `WINDOWS_CSC_KEY_PASSWORD`: certificate password.

macOS:

- `MACOS_CSC_LINK`
- `MACOS_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Tag-triggered releases fail when signing material is missing. A manual workflow
may set `allow_unsigned=true` for a private dry run, but such artifacts must not
be published to users.

## Update behavior

Production packages dynamically load `electron-updater`. Development mode does
not contact any update provider. Stable versions use the stable channel;
`-beta`, `-rc`, and `-alpha` versions use prerelease channels.

The application:

1. checks after a bounded startup delay;
2. checks periodically while open;
3. downloads an available update in the background;
4. exposes progress in About and the tray menu;
5. installs only after the user chooses **Install and restart** or when the
   updater performs its normal quit-time installation.

Windows update signature verification remains enabled. macOS updates require a
signed application. Linux AppImage updates use the generated update metadata;
other Linux distribution formats should be updated through their package manager.

## Rollback

Do not replace a published asset in place. If a release is bad:

1. mark the GitHub Release as withdrawn in its notes;
2. publish a new patch version containing the fix;
3. retain the old checksums and manifest for auditability;
4. never reuse an existing tag or version.

Automatic downgrade is intentionally disabled. A manual rollback requires
uninstalling the current version and installing an older trusted artifact.

## Repository visibility and update source

The GitHub provider is intended for a public release repository. Installed
clients do not receive the workflow's private `GH_TOKEN`; therefore a private
repository requires a separately authenticated update service or a generic
update server. Do not ship a public client that depends on a developer token.

Manual `allow_unsigned=true` workflow runs only produce downloadable CI
artifacts. They never create or overwrite a GitHub Release. Only the signed tag
flow is allowed to publish update metadata consumed by installed clients.

## macOS runtime entitlements

The signed macOS bundle uses `build/entitlements.mac.plist` for the main bundle
and inherited helpers. Hardened Runtime, code-sign verification, Gatekeeper
assessment and stapling validation are all release gates. Keep these
entitlements minimal; expand them only when a verified native dependency needs
an additional capability.
