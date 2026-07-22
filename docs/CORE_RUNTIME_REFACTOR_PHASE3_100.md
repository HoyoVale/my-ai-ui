# Core Runtime Refactor Phase 3

## Scope

Phase 3 splits the two largest remaining orchestration classes without changing their public APIs or persisted schemas:

- `electron/platform/PlatformKernel.js`
- `electron/conversation/ConversationManager.js`

The refactor keeps each class as a compatibility facade and moves lifecycle logic into one authoritative service per responsibility.

## Platform structure

```text
electron/platform/
├─ PlatformKernel.js
├─ PlatformKernelInternals.js
├─ state/PlatformStateProjector.js
├─ runs/PlatformRunService.js
├─ tasks/PlatformTaskService.js
├─ leases/PlatformLeaseService.js
├─ jobs/PlatformLongRunningService.js
└─ completion/PlatformCompletionService.js
```

Responsibilities:

- State projector: snapshot loading, Journal replay, event projection and commits.
- Run service: run creation, failure/replan records, status transitions and recovery.
- Task service: Task Graph, Agent Run, checkpoints, handoffs and evaluations.
- Lease service: acquire, renew, release and expire resource leases.
- Long-running service: jobs, wake policies, approvals, input, notifications and lifecycle state.
- Completion service: artifacts, integration, review, evidence and Completion Authority.

`PlatformKernel.js` now retains constructor wiring and delegates the existing public methods to these services.

## Conversation structure

```text
electron/conversation/
├─ ConversationManager.js
├─ ConversationManagerInternals.js
└─ services/
   ├─ ConversationStateService.js
   ├─ ConversationExecutionService.js
   ├─ ConversationMessageService.js
   └─ ConversationToolRecoveryService.js
```

Responsibilities:

- State service: load/save, session creation, navigation, workspace/model/Skill binding and pruning.
- Execution service: Execution Thread and Goal lifecycle operations.
- Message service: messages, regeneration, metadata, context and interrupted-run recovery.
- Tool recovery service: task-scoped Runtime recovery history and decisions.

`ConversationManager.js` keeps constructor dependencies and all existing public method names.

## Compatibility

Phase 3 intentionally does not change:

- Conversation Store version or schema.
- Platform Snapshot or Journal schema.
- IPC channel names.
- Goal, Execution Thread, Task, Job or Completion Permit shapes.
- Existing callers of `PlatformKernel` or `ConversationManager`.

## Test updates

A new command is available:

```powershell
npm run test:phase3-core-runtime
```

It verifies the facade boundaries, service ownership, Platform behavior, Conversation behavior, long-running jobs, Supervisor integration and historical source contracts.
