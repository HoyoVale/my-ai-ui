# AgentRuntime Facade Cleanup Phase 2.1

## Scope

This patch is a behavior-preserving cleanup after the Phase 2 AgentRuntime split.
It addresses Oxlint warnings caused by facade methods destructuring parameters and
then forwarding through `apply(this, arguments)`.

## Changes

- Facade delegates now forward explicit values through `.call(this, ...)`.
- Object-style APIs forward one `options` object without re-declaring every field.
- Public method names, argument shapes, default behavior, and lifecycle ownership remain unchanged.
- The unused `node:path` import was removed from `AgentRunExecution.js`.
- The Phase 2 architecture test now requires lint-friendly delegation and rejects
  a return to `apply(this, arguments)`.

## Files

```text
electron/agent/AgentRuntime.js
electron/agent/execution/AgentRunExecution.js
tests/agent/agentRuntimePhase2Architecture98.test.js
```

## Validation

```text
Node syntax checks: passed
Phase 2 architecture and related source contracts: 8 passed, 0 failed
Cold overlay verification: passed
```

Run locally:

```powershell
npm run lint
npm run test:phase2-agent-runtime
npm run build
```

Expected lint result:

```text
0 warnings
0 errors
```
