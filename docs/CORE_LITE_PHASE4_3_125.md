# Core Lite 4.3 — Retry boundaries and error consistency

Core Lite 4.3 makes retries explicit and conservative.

## Provider requests

The Runtime, not the provider SDK, owns automatic retries. Every `streamText()` call sets SDK retries to zero. The main model loop may retry only when all conditions hold:

- the error is transient (`rate_limited`, `timeout`, `network`, or `unavailable`);
- the configured retry limit has not been reached;
- no public text has been emitted;
- no Tool call has started;
- the Run deadline can accommodate the backoff;
- the user has not cancelled the Run.

Finalization is Tool-free and uses atomic response replacement, so a transient finalization failure may retry after partial text without duplicating the answer.

Authentication, permission, quota, invalid-request, missing-model and conflict errors are never automatically retried. An open circuit requires a later manual retry rather than waiting inside the current Run.

## Tool calls

Tool retry eligibility remains constrained by effect and idempotency:

- read/no-effect Tools can retry transient and rate-limit failures;
- writes retry only when their Runtime contract proves idempotency;
- permission, policy, invalid-input, conflict, timeout and cancellation failures never retry automatically;
- backoff is exponential and honors a bounded `retryAfterMs` value.

A generic `AbortError` is not treated as user cancellation unless the Run/Tool AbortSignal is actually aborted.

## Skill notifications

A Renderer closing during a Skill registry broadcast is an expected subscriber disconnect. It no longer writes a warning stack to normal test or application logs. Unexpected listener errors are still reported.

## Verification

```powershell
npm run test:core-lite4.3
npm run check:full
```
