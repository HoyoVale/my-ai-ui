# Core Lite 4.8 — Real Electron fault injection and release-candidate evidence

Core Lite 4.8 turns the lifecycle work from 4.1–4.7 into an executable desktop
release gate. It does not add a second runtime or new orchestration features.
The phase verifies the existing Core Lite path inside real Electron processes on
Windows and Linux and records machine-readable evidence for every candidate.

## Scope

The release-candidate E2E uses Playwright `_electron.launch()` with a temporary
but reusable Electron `userData` directory. One run exercises:

1. a multi-second deterministic final-response stream;
2. Response renderer reload while chunks are arriving;
3. Response BrowserWindow destruction and automatic recreation;
4. Conversation BrowserWindow destruction and recreation;
5. graceful application quit and restart with the same persisted profile;
6. application quit while a stream is active;
7. restart recovery to a cancelled, non-resumable terminal state;
8. a new run after restart to detect stale listeners or duplicated windows.

The test also inventories BrowserWindows after churn and rejects duplicate Pet,
Input, Response or Conversation windows. Renderer crashes/page errors and main
process console errors fail the release gate. Screenshots and diagnostic logs are
kept in `test-results/core-lite-4.8/`.

## Long-stream driver

`electron/agent/e2eAgentDriver.js` supports deterministic long streams triggered
by `e2e-long-stream*` messages. The chunk count and delay are test-only settings:

```text
XIXI_E2E_LONG_STREAM_CHUNKS
XIXI_E2E_LONG_STREAM_DELAY_MS
```

The long-stream work exposed a listener leak in the old delay helper: every
chunk attached an AbortSignal listener, but successful timer completion did not
remove it. Core Lite 4.8 cleans the listener on both resolve and reject. The unit
contract verifies that a completed or aborted long stream leaves zero `abort`
listeners.

## Evidence reports

The lifecycle soak and Electron E2E both write schema-versioned JSON reports:

```text
core-lite-lifecycle-soak
core-lite-4.8-electron-release-candidate
```

Reports contain platform, architecture, Node version, timing, scenario status,
fault counters and bounded diagnostics. They are generated atomically so CI
never uploads a half-written report.

`scripts/create-release-candidate-summary.mjs` recursively reads the collected
reports, requires both suites for every requested platform, checks all reports
and scenarios are passed, hashes every source report and records the
`package-lock.json` SHA-256. The resulting summary is the release-candidate
baseline, not a replacement for signed installers or manual visual review.

## CI authority

`.github/workflows/ci.yml` now provides four jobs:

```text
Core (Windows / Linux)
Electron smoke (Windows / Linux)
Electron E2E (Windows / Linux)
Core Lite 4.8 release candidate summary
```

The final job downloads all `core-lite-4.8-*` artifacts and requires evidence
for both `linux` and `win32`. The scheduled soak workflow writes a 30-minute
lifecycle report by default and archives it for 30 days.

## Commands

```powershell
npm run test:core-lite4.8
npm run test:stress:core-lite4.8
npm run test:e2e:electron-rc
npm run report:core-lite4.8
npm run test:soak:core-lite4.8
```

`npm run check:full` runs the quick stress gate, real Electron release candidate
and local report summary in addition to the existing crash recovery, benchmark,
preload smoke and full Playwright flow.

## Generated output policy

`test-results/` and `playwright-report/` are legitimate local/CI outputs. They
are ignored by Git and excluded by the fresh source archive builder. The Core
Lite tree verifier no longer rejects the mere presence of generated reports;
instead, it verifies both exclusion mechanisms remain configured. Patch cleanup
still removes stale generated files from user-provided source archives.

## Release boundary

A Core Lite 4.8 candidate is eligible for the next packaging stage only when:

- stable Core Lite and phase contracts pass;
- lint and production build pass;
- lifecycle stress reports pass on Windows and Linux;
- preload smoke passes on Windows and Linux;
- real Electron crash recovery passes;
- Electron release-candidate E2E passes on Windows and Linux;
- the cross-platform summary reports `status: "passed"`;
- no unresolved Tool side effects or resumable interrupted runs are hidden by
  the test flow.
