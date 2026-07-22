# Execution Model 2.0 — Phase E Platform Bridge

## 1. Scope

Phase E maps Platform execution into explicit Execution Model child Threads while preserving the existing Platform authority model.

The bridge is intentionally one-way:

```text
Platform Task Graph / AgentRun / Evidence / Completion Authority
                         ↓ read-only identity and trace bridge
Supervisor Thread / Worker Thread / Evaluator Thread / Integration Thread / Reviewer Thread
```

A child Thread never changes Task status, Evidence validity, Integration state, Goal status, or Completion Permit state.

## 2. New modules

```text
electron/execution-model/PlatformExecutionBridge.js
electron/platform/bridge/PlatformExecutionBridgeService.js
```

`PlatformExecutionBridge.js` provides:

- deterministic Supervisor and child Thread identities;
- one child Thread and one Execution Run per Platform AgentRun;
- role mapping for Worker, Evaluator, Integrator, and Reviewer;
- Platform snapshot migration for legacy AgentRuns;
- AgentRun finish and crash-recovery synchronization;
- read-only Artifact, Evidence, Review, and Integration trace projection;
- bridge invariant validation.

`PlatformExecutionBridgeService.js` exposes read-only PlatformKernel APIs:

```js
platformKernel.getExecutionBridge(platformRunId)
platformKernel.getAgentExecutionThread(platformRunId, agentRunId)
platformKernel.validateExecutionBridge(platformRunId)
```

## 3. Stored Platform bridge model

Each Platform Run now contains:

```text
executionBridge
├─ supervisorThread
├─ childThreads{}
└─ agentRunBindings{}
```

The Supervisor Thread is created with the Platform Run. Each call to `beginAgentRun()` creates exactly one child Thread and one Execution Run.

```text
Platform Run
└─ Supervisor Thread
   ├─ Worker Thread
   ├─ Evaluator Thread
   ├─ Integrator Thread
   └─ Reviewer Thread
```

AgentRun records now contain:

```text
executionThreadId
executionRunId
parentExecutionThreadId
executionKind
```

These fields are identity metadata. The AgentRun remains the Platform execution authority.

## 4. Role mapping

| Platform execution | Child Thread kind |
|---|---|
| implementer or ordinary Worker | `worker` |
| independent task evaluator | `evaluator` |
| integration AgentRun | `integrator` |
| independent integration reviewer | `reviewer` |

Retries create new AgentRuns and therefore new child Threads. A terminal AgentRun is never reopened.

## 5. Lifecycle synchronization

AgentRun lifecycle is projected to child Thread and Execution Run state:

| AgentRun | Child Thread | Execution Run |
|---|---|---|
| running | running | running |
| completed | completed | completed |
| failed | failed | failed |
| cancelled | cancelled | cancelled |
| interrupted | continuable | continuable |

Platform Run status is projected to the Supervisor Thread. This projection does not drive the Platform Run state machine.

## 6. Persistence and migration

Platform snapshot state advances from version 5 to version 6.

Legacy Platform Runs that already contain AgentRuns but no `executionBridge` are migrated during `ensureLoaded()`:

- deterministic Supervisor Thread is created;
- every historical AgentRun receives a deterministic child Thread;
- terminal AgentRun status is preserved;
- AgentRun identity fields are backfilled;
- no Task, Artifact, Evidence, Review, or Completion data is changed.

The Journal remains authoritative. The bridge can be rebuilt from persisted Platform Runs and AgentRuns.

## 7. Crash recovery

Existing `recoverInterruptedRuns()` remains authoritative.

When a running AgentRun is recovered after restart:

```text
AgentRun: running → interrupted
Task: running → continuable
Child Thread: running → continuable
Execution Run: running → continuable
```

Recovery does not automatically:

- call a model;
- restart a Worker;
- replay a Tool;
- repeat a file or remote write;
- issue a Completion Permit.

## 8. Trace projection

`getExecutionBridge()` returns bounded references for each child Thread:

```text
trace
├─ artifactIds
├─ evidenceIds
├─ reviewIds
└─ integrationIds
```

The Supervisor projection also exposes:

- Task Graph revision;
- all child Thread IDs;
- Integration digest;
- Completion Permit fingerprint.

Full Artifact, Evidence, Review, Tool Result, and Diff data remain in their existing authoritative stores.

## 9. Authority invariants

Phase E enforces these rules:

1. One Platform AgentRun maps to one child Thread.
2. One child Thread contains one Execution Run for that AgentRun.
3. Every child Thread is parented by the Platform Run Supervisor Thread.
4. Task Graph remains authoritative for dependencies and Task state.
5. PlatformTaskService remains the only Task mutation path.
6. Evidence validity remains owned by Platform Run services.
7. CompletionAuthority remains the only source of Completion Permits.
8. Worker or Reviewer Thread state cannot directly complete or fail a Goal.
9. Integration publication still requires independent Review.
10. Bridge projection never copies large Tool or Diff payloads.

## 10. Validation

Phase E dedicated and Platform integration tests:

```text
34 passed
0 failed
```

Execution Model A–E and architecture/regression tests:

```text
73 passed
0 failed
```

All Platform test suites:

```text
46 passed
0 failed
```

Crash recovery:

```text
Platform Kernel crash recovery passed
Multi-Agent Supervisor crash recovery passed
Supervisor pre-handoff checkpoint recovery passed
```

## 11. Production behavior

Phase E changes Platform persistence and diagnostics, but does not switch the ordinary Conversation Thread Router out of Shadow Mode.

It does not modify:

- Conversation Store v23;
- ordinary Execution Thread routing;
- Steering Queue activation;
- Input UI;
- Conversation UI;
- Provider continuation requests;
- Task Graph rules;
- Completion Authority rules.

The next planned stage is Phase F: UI and interaction projection for current Thread, current Run, child Agent Threads, lineage, and routing diagnostics.
