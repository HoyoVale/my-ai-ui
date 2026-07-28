# Core Lite 4.6 — Run lifecycle races and resource cleanup

## Goal

Make every Agent Run terminalize exactly once when completion, cancellation,
timeout, retry failure, window destruction and application shutdown overlap.

## Runtime contract

```text
active Run
  → one settlement owner
  → stop new work and approval
  → quiesce Tool Session
  → derive and persist one terminal result
  → release registered resources once
  → clear activeRun
```

`RunLifecycleCoordinator` owns the settlement promise and the resource cleanup
registry. A second terminal caller receives the first caller's promise and may
not independently update terminal state.

## Cleanup order

1. Close pending Tool approval.
2. Abort the Tool Session scope.
3. Terminate supervised subprocess trees.
4. Wait a bounded interval for the Tool scheduler to become idle.
5. Close Tool event and receipt persistence.
6. Remove status-window listeners and cached projections.

Each resource has an independent timeout. One failed cleanup does not prevent
remaining resources from being released.

## Application shutdown

The Electron `before-quit` path waits for `AgentRuntime.shutdown()` before the
global persistence queue is flushed and MCP clients are closed. New messages
and regeneration requests are rejected once shutdown begins.

## Renderer close containment

Agent status and Response stream delivery verify WebContents liveness and
catch destruction races. Failed delivery is not cached as a successful
revision, and destroyed status subscribers are removed immediately.

## Verification

The phase contract covers:

- one terminal owner and shared settlement result;
- idempotent priority-ordered cleanup;
- bounded cleanup and late resource registration;
- all production `finalizeRun()` calls being awaited;
- shutdown ordering;
- new-run rejection during shutdown or terminal cleanup;
- Response and Agent status WebContents races;
- Tool Session AbortSignal, scheduler and subprocess cleanup;
- previous cancellation, terminal-presentation and persistence regressions.
