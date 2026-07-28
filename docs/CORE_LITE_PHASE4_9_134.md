# Core Lite 4.9 — Packaging, Signing, Updating and Release

Core Lite 4.9 turns the validated runtime into a distributable desktop
application. It closes four production gaps:

1. packaged windows now load `dist/index.html` rather than localhost;
2. the application has a stable app ID, semantic version and single-instance
   identity;
3. production packages expose a bounded auto-update lifecycle;
4. Git tags drive a signed, checksummed and attestable GitHub Release workflow.

## Production renderer

`rendererTarget.js` is the single resolver for development and packaged URLs.
Vite uses a relative asset base, and the renderer security policy trusts only
the exact packaged `dist/index.html` URL, never arbitrary local files.

## Update boundary

`UpdateService` contains the state machine and dynamically imports
`electron-updater` only in packaged builds. The development dependency graph
remains lockfile-stable. Release packaging installs pinned builder/updater
versions in a disposable tooling step and restores `package.json` after build.

Update state is available through IPC and visible in About and the tray. Public
error text is bounded and excludes stack traces.

## Release evidence

The release workflow requires version/tag equality, Core Lite checks, platform
signing, update metadata, artifact hashes and a release manifest. Public
repositories also generate provenance attestations. Existing GitHub Releases
are never overwritten.

The authoritative operational guide is `docs/RELEASE.md`.

## Fail-closed release refinements

Manual unsigned matrix builds stop after artifact upload and never enter the
GitHub Release publishing job. The macOS gate uses portable BSD-compatible
`find`, validates code signing, Gatekeeper assessment and the stapled
notarization ticket. Hardened Runtime helpers inherit the minimal Electron JIT
entitlements from `build/entitlements.mac.plist`.
