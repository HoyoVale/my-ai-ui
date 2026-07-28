# Core Lite 4.7 — Lifecycle Stress and Fault Injection

Core Lite 4.7 does not add another runtime layer. It stress-tests the Core Lite
4.6 lifecycle and hardens the failure boundaries that only appear under repeated
cancellation, renderer reload, stalled persistence, child-process termination
and concurrent application shutdown.

## Fixed fault boundaries

### Bounded persistence shutdown

`flushAllPersistenceQueues()` now treats an active write as pending, applies a
hard timeout to every flush attempt, and reports timed-out attempts. Critical
shutdown timers remain referenced so Node cannot leave the event loop before the
bounded flush result is produced.

### Replayable Response delivery

`ResponseStreamReplayBuffer` stores one bounded authoritative stream snapshot.
When the Response renderer reloads or is temporarily unavailable, stream chunks
are not accumulated as an unbounded IPC queue. The next renderer receives
`start → replace(snapshot) → end` and non-stream messages remain bounded.

### Safe asynchronous status broadcast

`CoalescedStatusBroadcaster` isolates synchronous and asynchronous subscriber
failures, prevents overlapping publishes, coalesces updates received while a
publish is in flight, and exposes an idle waiter for shutdown tests.

### Supervised subprocess races

`SubprocessSupervisor` rechecks an AbortSignal immediately after the listener is
attached, so cancellation cannot be lost in the spawn/listener gap. Concurrent
`terminateAll()` calls share one termination request and retain the first
shutdown reason.

### Settlement failure observation

`RunLifecycleCoordinator` privately observes settlement rejection until a
shutdown waiter attaches, preventing a transient unhandled-rejection report
without changing the rejection seen by callers.

## Commands

Fast deterministic fault injection:

```powershell
npm run test:core-lite4.7
```

Short CI stress gate:

```powershell
npm run test:stress:core-lite4.7
```

Ten-minute local soak:

```powershell
npm run test:soak:core-lite4.7
```

Custom 30-minute run:

```powershell
node tests/performance/core-lite-lifecycle-soak.mjs `
  --seconds=1800 `
  --iterations=500000 `
  --subprocess-every=500
```

The soak reports lifecycle iterations, real child-process cancellations,
injected renderer failures, cleanup failures, persistence attempts and heap
growth. It must finish with no pending persistence queue and no supervised
child process.

## CI boundary

The GitHub Actions Core job runs the short stress gate on both Ubuntu and
Windows after lint, unit tests and build. The ten-minute soak remains an
explicit local/release validation so ordinary pull requests stay bounded.
