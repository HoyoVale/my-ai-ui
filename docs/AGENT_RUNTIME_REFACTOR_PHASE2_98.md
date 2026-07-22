# Agent Runtime Refactor Phase 2

## Scope

Phase 2 is a behavior-preserving structural refactor of `AgentRuntime`.
It does not change the Conversation schema, Goal schema, Tool protocol,
Provider request shape, UI contract, or execution state machine.

The previous `electron/agent/AgentRuntime.js` combined preparation,
execution, finalization, persistence, status projection, recovery,
approval, and diagnostics in one file of about 4,239 lines.

Phase 2 keeps `AgentRuntime` as the public facade and moves four lifecycle
responsibilities into independently testable modules.

## Resulting structure

```text
electron/agent/
├─ AgentRuntime.js                         public facade and runtime status
├─ AgentRuntimeInternals.js                shared lifecycle helpers
├─ preparation/
│  └─ AgentRunPreparation.js               send and regenerate preparation
├─ execution/
│  └─ AgentRunExecution.js                 E2E, segment and model execution
├─ finalization/
│  └─ AgentRunFinalization.js              cancellation and final answer phase
└─ persistence/
   └─ AgentRunPersistence.js               checkpoint, activity and message writes
```

`AgentRuntime.js` is reduced to roughly 1,300 lines. Public method names and
call signatures remain available. Each moved method is delegated with the
original `this` binding and arguments.

## Responsibility boundaries

### Preparation

Owns:

- ordinary message preparation;
- regeneration preparation;
- Conversation target validation;
- continuation and Execution Thread selection;
- Skill resolution;
- memory and context assembly;
- active run creation;
- Goal and Platform execution registration.

### Execution

Owns:

- deterministic E2E execution;
- Tool Session construction;
- capability and prompt assembly;
- segmented model execution;
- Tool loop callbacks;
- Token Ledger updates during execution;
- Goal verification and RunEngine orchestration.

### Finalization

Owns:

- terminal state projection;
- cancelled-run completion;
- model finalization attempts;
- public text sanitization;
- deterministic fallback summaries;
- Goal, Platform and Execution Thread completion writes;
- final Activity and Diff persistence.

### Persistence

Owns:

- compact checkpoint construction;
- Assistant placeholder creation;
- live checkpoint persistence;
- Tool activity record projection;
- model step classification;
- final and live Assistant message persistence.

### Facade responsibilities retained

`AgentRuntime` still owns:

- one active-run reference;
- public IPC-facing methods;
- status and snapshot projection;
- provider circuit breakers;
- Tool approval resolution;
- runtime recovery and diagnostics;
- stop and connection-test entry points.

## Stability rules

- No new Conversation or Goal schema version.
- No duplicate old/new execution implementation.
- No lifecycle module imports `AgentRuntime.js`.
- The facade delegates to exactly one owner for each moved method.
- Existing runtime, recovery, Goal, Plan, Diff and Tool contracts remain valid.
- Source-contract tests read the complete runtime architecture rather than
  requiring implementation details to remain in one file.

## Tests

New test:

```text
tests/agent/agentRuntimePhase2Architecture98.test.js
```

It verifies:

- the facade remains under the structural size boundary;
- Preparation, Execution, Finalization and Persistence each own their methods;
- the facade contains delegates rather than duplicate implementations.

New helper:

```text
tests/helpers/agentRuntimeSource.js
```

It lets historical source-contract tests validate the complete runtime after
the implementation was split across modules.

Run:

```powershell
npm run test:phase2-agent-runtime
npm run test:phase1-consistency
npm test
npm run test:e2e
```
