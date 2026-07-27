# Core Lite 3.6 P0 — Reliable Baseline

This phase restores a reliable Core Lite source and test baseline before Runtime stabilization.

## Changes

- Replaced the retired `/goal` Electron E2E path with a negative `/goal` assertion and a positive `/model` command flow.
- Removed 59 stale Goal, Plan, Execution Model, orchestration, fixture, and test files that were accidentally reintroduced in `my-ai-ui(118).zip`.
- Removed generated `test-results`, local logs, and the machine-local `.env` from the source tree.
- Added `verify:core-lite-tree` and made it the first step of `npm run check`.
- Added a clean source archive builder that stages a fresh tree, deletes an existing destination ZIP, excludes local/generated content, extracts the result, and verifies every file hash.

## Commands

```powershell
npm run verify:core-lite-tree
npm run test:core-lite3.6:p0
npm run archive:source -- ..\my-ai-ui-clean.zip
npm run check:full
```

The source archive retains `.env.example` but never includes `.env`, `node_modules`, build output, test output, logs, or existing ZIP files.
