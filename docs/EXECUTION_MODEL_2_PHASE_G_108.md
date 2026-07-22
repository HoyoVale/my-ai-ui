# Execution Model 2.0 — Phase G

## Shadow Rollout and guarded authority cutover

Phase G completes the staged Thread Routing rollout on the `my-ai-ui(106)` baseline.

The new `ExecutionThreadRouter` is no longer diagnostic-only for every operation. It can now become the effective routing authority for safe `start`, `resume`, and `regenerate` decisions while preserving the legacy route as an immediate fallback.

`steer` and `fork` remain modeled but are not executed in production in this phase.

---

## 1. Rollout modes

The hidden developer setting is:

```json
{
  "conversation": {
    "executionRouting": {
      "mode": "guarded",
      "minimumSamples": 12,
      "maxMismatchRate": 0.35,
      "maxHighRiskMismatches": 0,
      "windowSize": 100,
      "autoRollback": true
    }
  }
}
```

Supported modes:

| Mode | Behavior |
|---|---|
| `legacy` | Legacy route executes. The new Router remains auditable. |
| `shadow` | New and legacy decisions are compared, but legacy executes. |
| `guarded` | Safe agreed decisions execute through the new Router. Low-risk mismatches require a healthy observation window. |
| `authority` | Safe low-risk mismatches may execute immediately. Safety guards and automatic rollback still apply. |

The default is `guarded`.

No ordinary-user UI switch was added. Rollout diagnostics are developer-only.

---

## 2. Eligible production actions

Phase G allows authority cutover only for:

```text
start
resume
regenerate
```

The following remain fallback-only:

```text
steer
fork
reject
```

Active-run input is still rejected by the current production path. The `SteeringQueue` is not injected into model execution.

Fork lineage remains modeled but no Fork operation is applied.

---

## 3. Guarded decision rules

### New and legacy routes agree

The new Router becomes authoritative immediately when:

- the action is eligible;
- there is no active Run conflict;
- Workspace and Thread ownership are valid;
- the new and legacy action agree.

### Explicit new task

An explicit `start` command can override a legacy `resume` immediately when safety checks pass.

This prevents a clear new-task request from silently continuing an old Thread.

### Workspace change

A Router decision to start a new Thread after a Workspace change is applied immediately.

A Thread from another Workspace is never resumed through rollout authority.

### Low-risk mismatch

A semantic low-risk mismatch such as:

```text
new Router: resume
legacy Router: start
reason: feedback-on-current-thread
```

is applied in `guarded` mode only after the observation window satisfies:

- minimum sample count;
- mismatch rate threshold;
- zero or configured maximum high-risk mismatches.

### High-risk mismatch

High-risk mismatches never cut over, even in `authority` mode.

Examples:

- active Run conflict;
- `resume` versus legacy `reject`;
- missing target Thread;
- cross-Workspace resume;
- duplicate regeneration Run identity;
- unsupported `steer` or `fork` execution.

---

## 4. Automatic rollback

When the configured observation window becomes unhealthy, the rollout automatically falls back to the legacy action.

Tracked metrics include:

```text
sampleSize
mismatchCount
mismatchRate
highRiskMismatchCount
authorityCount
fallbackCount
autoRollbackCount
```

Automatic rollback does not delete or rewrite historical Routing Decisions.

---

## 5. Durable audit metadata

Each Routing Decision can now persist:

```text
rollout.mode
rollout.eligible
rollout.authority
rollout.effectiveAction
rollout.fallbackAction
rollout.reason
rollout.risk
rollout.autoRollback
rollout.metrics
```

The original Router action remains unchanged for comparison. The actually executed action is stored in `rollout.effectiveAction`.

Decision state is promoted from:

```text
proposed → applied
```

only after the Execution Thread Run is successfully created.

Conversation Store remains version `23`. The existing bounded `routingDecisions[]` field stores the rollout metadata without another Store migration.

---

## 6. Runtime integration

`AgentRunPreparation` now performs:

```text
1. Calculate the legacy continuation decision.
2. Calculate the ExecutionThreadRouter decision.
3. Evaluate rollout health and safety.
4. Choose effectiveAction.
5. Resolve Start or Resume state from effectiveAction.
6. Create exactly one Run.
7. Mark the Routing Decision applied after Thread creation.
```

For `start`, any legacy continuation state is discarded.

For `resume`, the target Thread is resolved from the durable Thread collection. If the legacy continuation was absent but rollout authority selected a safe resume, a continuation snapshot is created from the target Thread.

For `regenerate`, the existing Thread is reused and a distinct target Run identity is required.

---

## 7. Safety invariants

Phase G enforces:

1. No authority while another Run is active.
2. No cross-Workspace Thread resume.
3. No resume without a reusable target Thread.
4. No regeneration without source and target Run lineage.
5. No regeneration when the target Run already exists.
6. No `steer` or `fork` production cutover.
7. One accepted input creates one Run.
8. Legacy route remains available for fallback.
9. Rollout metadata survives Conversation reload.
10. Ordinary UI does not expose rollout controls or internal IDs.

---

## 8. Developer diagnostics

The developer task panel now includes:

```text
Thread routing rollout
```

It exposes the bounded Routing Decision snapshot and rollout metrics only after developer diagnostics are explicitly loaded.

The ordinary activity timeline does not display:

- rollout mode;
- mismatch rate;
- Thread ID;
- Run lineage;
- fallback reason;
- Router authority state.

---

## 9. Files

New modules:

```text
electron/execution-model/RoutingRolloutPolicy.js
electron/execution-model/RoutingRolloutController.js
```

Updated runtime and persistence:

```text
electron/agent/preparation/AgentRunPreparation.js
electron/execution-model/ThreadRoutingDecision.js
electron/execution-model/ThreadRoutingDecisionStore.js
electron/execution-model/index.js
electron/settings/validateSettings.js
src/shared/defaultSettings.js
```

Developer diagnostics:

```text
src/Conversation/components/DeveloperActivityPanel.jsx
```

Tests:

```text
tests/execution-model/executionModelPhaseG108.test.js
tests/execution-model/executionModelPhaseC104.test.js
tests/execution-model/executionModelPhaseD105.test.js
```

---

## 10. Test command

```powershell
npm run test:phaseG-shadow-rollout
```

Phase G keeps the fallback path intentionally. Completion of Shadow Rollout means safe authority cutover, health monitoring, and automatic rollback are implemented—not that the legacy route is prematurely deleted.
