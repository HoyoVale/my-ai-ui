# Core Lite 3.5 check:full hotfix (117)

This hotfix addresses the two failures reported by `npm run check:full` after Core Lite 3.5.

## Fixes

1. Tool records created by a direct Core Lite run now use `runId` as the legacy runtime partition fallback when no explicit `segmentId` is supplied. This keeps persisted Tool records and compatibility tests stable after the Execution Segment runtime was removed.
2. The runtime hardening test now enforces the Core Lite 3.4 contract: `get_agent_status` must not expose `plan` or `planTruncated` fields.

## Packaging cleanup

The uploaded `my-ai-ui(117).zip` contained stale files that had already been removed in Core Lite 3.3-3.5. The patch deletion script removes those exact retired targets. It is safe when the files are already absent.

## Validation

- `npm run test:core-lite3.5`: 87/87 passed.
- Full dependency-free Node scan: 554 passed; 35 files could not load because external packages are not installed in the validation environment; no assertion or TypeError regressions remained.
