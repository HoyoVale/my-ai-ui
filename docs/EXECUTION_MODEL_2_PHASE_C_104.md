# Execution Model 2.0 — Phase C: Thread Routing Shadow Mode

## 1. Purpose

Phase C introduces one routing model for ordinary messages, continuation, active-run steering, forks, and regeneration. The new router is intentionally deployed in **Shadow Mode**:

- the new router calculates and audits a decision;
- the legacy continuation logic remains the production authority;
- no new thread, run, or steering input is applied by the new router;
- differences are recorded as `shadow.mismatch` for later evaluation.

This avoids changing user-visible execution semantics before real routing data has been evaluated.

## 2. New modules

```text
electron/execution-model/
├─ ThreadCommand.js
├─ ExecutionThreadRouter.js
├─ ThreadRoutingDecisionStore.js
└─ SteeringQueue.js
```

### ThreadCommand

Normalizes structured commands and conservatively classifies message intent:

- `start`
- `resume`
- `steer`
- `fork`
- `regenerate`

The classifier returns bounded evidence codes rather than storing the original user message in routing audit records.

### ExecutionThreadRouter

Produces a `ThreadRoutingDecision` from:

- current Conversation;
- current Execution Thread;
- current Active Run;
- workspace binding;
- structured thread command;
- explicit continuation flag;
- operation type;
- legacy routing result.

Important rules:

1. A reusable current thread is resumed by default.
2. Explicit new tasks start a new thread.
3. Ordinary failure feedback can be classified as a continuation.
4. Input received while a run is active is proposed as `steer`.
5. Explicit commands cannot open a parallel task while a run is active.
6. A changed workspace never silently resumes the old thread.
7. Fork and regenerate preserve source lineage.
8. Every decision is `proposed`; Phase C does not apply it.

### ThreadRoutingDecisionStore

Provides an in-memory, bounded Shadow audit store:

- maximum 300 decisions by default;
- decision update after real message/thread/run IDs are known;
- filtering by Conversation or Run;
- mismatch count;
- action and legacy-action counts;
- no raw user message body.

Persistence is deliberately deferred to Phase D.

### SteeringQueue

Defines the future active-run input queue:

- input is scoped to one Thread and one Run;
- supports enqueue, peek, drain, cancellation, and bounded retention;
- prevents cross-run consumption.

The production Runtime does **not** call `steeringQueue.enqueue()` in Phase C. This is enforced by tests.

## 3. Shadow integration

### Ordinary messages

`AgentRunPreparation.startMessage()` now:

1. normalizes the optional `threadCommand`;
2. computes the existing legacy continuation result;
3. asks `ExecutionThreadRouter` for a Shadow decision;
4. records `legacyAction`, new `action`, and mismatch;
5. continues through the unchanged legacy route;
6. binds the accepted user message, Execution Thread, and Run IDs to the decision.

### Messages while busy

The legacy behavior remains:

```text
busy → reject message
```

The Shadow decision records:

```text
active run → steer
legacy → reject
mismatch → true
```

No input is queued or injected yet.

### Regeneration

`regenerateMessage()` also creates a Shadow decision with:

- source Run;
- target Run;
- target Thread;
- regeneration command;
- legacy regeneration action.

Regeneration remains blocked while another Run is active.

### IPC compatibility

The existing message request now accepts an optional:

```text
threadCommand
```

Legacy string callers and callers without this field remain compatible.

## 4. Developer diagnostics

Developer Run details now include:

```text
threadRouting
├─ total
├─ mismatchCount
├─ byAction
├─ byLegacyAction
└─ decisions
```

This is an in-memory diagnostic projection. It is not stored in Conversation data yet.

## 5. Explicit non-goals

Phase C does not:

- replace `resolveCheckpointContinuation()`;
- replace `resolveExecutionThreadContinuation()`;
- create multiple persisted Threads;
- change Conversation Store version 22;
- write routing decisions into Conversation JSON;
- inject Steering Queue inputs into a running model;
- enable a Fork UI;
- change Goal or Platform routing;
- change user-visible busy behavior.

## 6. Tests

New command:

```powershell
npm run test:phaseC-thread-routing
```

Coverage includes:

- structured Thread commands;
- explicit Start and Resume;
- ordinary feedback continuation;
- active-run Steer proposal;
- active-run parallel command rejection;
- workspace mismatch protection;
- Fork and Regenerate lineage;
- busy regeneration rejection;
- Decision Store bounding and mismatch metrics;
- Steering Queue isolation;
- IPC compatibility;
- proof that Shadow Mode does not enqueue steering inputs;
- proof that Conversation Store remains version 22.

## 7. Exit criteria

Phase C is complete when:

- all message and regeneration entry points calculate a Shadow decision;
- legacy routing remains authoritative;
- every accepted Run can be linked to its Shadow decision;
- mismatches are inspectable in developer diagnostics;
- no raw input is copied into routing audit records;
- no Steering Queue input is applied;
- Phase A–B and Phase 1–4 regressions remain green.

## 8. Next phase

Phase D should add durable routing and thread lineage:

```text
activeExecutionThreadId
executionThreads
threadLineage
runLineage
providerContinuation
routingDecisions
```

Before switching authority, Phase D should also define a migration for the current single `executionThread` field and preserve the Shadow comparison data required for rollout decisions.
