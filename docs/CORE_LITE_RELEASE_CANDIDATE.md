# Core Lite release-candidate baseline

This document is the release authority for the current desktop Core Lite
runtime. A green unit test suite alone is not a release candidate.

## Required gates

| Gate | Command or evidence | Required platforms |
| --- | --- | --- |
| Source boundary | `npm run verify:core-lite-tree` | Any |
| Lint, unit and build | `npm run check` | Windows and Linux CI |
| Lifecycle fault injection | `npm run test:stress:core-lite4.8` | Windows and Linux |
| Preload / IPC smoke | `npm run test:electron` | Windows and Linux |
| Tool crash recovery | Runtime crash and write-crash matrix | Windows and Linux core job |
| Real Electron recovery | `npm run test:e2e:electron-runtime-crash` | Windows and Linux |
| Real window/restart faults | `npm run test:e2e:electron-rc` | Windows and Linux |
| Full desktop path | `npm run test:e2e` | Windows and Linux |
| Evidence aggregation | `release-candidate-summary.json` | Must include `linux` and `win32` |

## Evidence format

The final summary must include:

```json
{
  "schemaVersion": 1,
  "release": "core-lite-4.8",
  "status": "passed",
  "requiredPlatforms": ["linux", "win32"],
  "packageLockSha256": "...",
  "reports": []
}
```

Every referenced report is hashed. Missing, failed or malformed reports make the
summary fail. The summary is generated from downloaded CI artifacts, not from
console text.

## Not covered by this baseline

The baseline does not certify installer signing, auto-update, GPU-specific
visual behavior, accessibility review, real third-party Provider availability,
or manual visual quality. Those remain packaging and release-validation work.
