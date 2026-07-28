# Core Lite Architecture

The production desktop agent has one direct lifecycle:

```text
Input / Conversation
  → AgentRuntime
  → AgentRunSession
  → CoreLiteRunLoop
  → Provider model loop
  → Tool Runtime / MCP / Skill / Memory
  → final response or resumable checkpoint
```

## Runtime ownership

- `AgentRuntime` is the public facade and active-run owner.
- `AgentRunSession` contains one run's mutable state and the idempotent cancellation request.
- `CoreLiteRunLoop` executes one bounded run unit.
- `AgentRunExecution` owns provider streaming and Tool calls.
- `RunStateMachine` owns terminal outcome derivation.
- `RunTerminalPresentation` owns the bounded user-visible terminal code, title, message, suggested action and resumable flag for Provider, Tool, recovery, cancellation and finalization exits.
- `AgentRunFinalization` streams sanitized final text, reconciles it with execution evidence, and owns the single cancellation terminalization path before persistence.
- `FinalResponseStream` keeps Response and Conversation text incremental and atomically replaces provisional text when evidence changes the conclusion.
- Tool durability is owned by the Tool Runtime Journal, receipts and checkpoints.

## Explicitly absent

The production tree contains no Goal Runtime, Plan Authority, Execution Thread,
Segment Orchestrator, Platform Kernel, Multi-Agent Supervisor, Worker model,
Reviewer model or autonomous Worktree platform.

Complex behavior must be introduced as a bounded Tool, MCP server or Skill. It
must not create a second agent lifecycle beside `AgentRunSession`.

## Terminology

- **Run**: one user-triggered Agent execution.
- **Run unit**: the single bounded unit executed by `CoreLiteRunLoop`.
- **Step**: one provider model step inside the run unit.
- **Tool scope**: the durable correlation key used by Tool Journal records.
- **Checkpoint**: minimal resumable state for the same task binding.

Historical `segmentId` fields can still be read by Tool persistence migration,
but new high-level Agent code uses Run Unit terminology.

## Retry authority

Core Lite owns Provider retries. The SDK receives `maxRetries: 0`; the Runtime retries only transient failures before public output or Tool activity. Tool retries remain effect- and idempotency-aware. Both paths stop at cancellation, deadline and circuit-breaker boundaries.
## Checkpoint continuation authority

A resumable checkpoint is not executable until `CoreLiteCheckpointRecovery` validates its runtime version, task identity, Tool recovery state, Coding workspace and model identity. The continuation message is appended only after validation. The task-scoped Tool ledger is reopened and reconciled before the resumed model loop starts. Any unresolved Tool effect remains recovery work and blocks the Provider loop.

Checkpoint v6 may carry bounded partial public output. This is data for continuity, not an instruction source, and cancellation settings still control whether aborted partial text is retained.


## Terminal presentation authority

`RunStateMachine` remains the authority for internal outcome and phase. After terminalization, `RunTerminalPresentation` derives one sanitized public projection. The same projection is attached to Agent status, Activity snapshots and `message.metadata.run.terminal`. Provider stacks, Tool inputs, file paths and raw recovery diagnostics never enter this public object.

## Lifecycle settlement and cleanup authority

`RunLifecycleCoordinator` grants exactly one terminal owner for each
`AgentRunSession`. Completion, cancellation, timeout, Provider failure, Tool
failure and application shutdown all converge on that owner. Later terminal
requests wait for the same settlement promise instead of finalizing the run a
second time.

Before terminal evidence is read, the active Tool Session is quiesced: pending
approval is closed, the session AbortSignal is triggered, supervised child
processes are terminated and the Tool scheduler is given a bounded interval to
become idle. Registered resources are then released once, in priority order,
with per-resource timeouts.

Application shutdown waits for the active Agent Run before the global
persistence flush and MCP shutdown. Renderer destruction is contained at the
status and Response delivery boundaries so a closing window cannot keep stale
listeners or crash terminalization.

## Stress and fault-injection authority

Core Lite 4.7 treats lifecycle stress as a release contract rather than a new
runtime feature. `RunLifecycleCoordinator`, `AsyncPersistenceQueue`,
`CoalescedStatusBroadcaster`, `ResponseStreamReplayBuffer` and
`SubprocessSupervisor` expose bounded, deterministic behavior under repeated
terminal races, renderer reloads, stalled writes and process termination.

The short stress gate runs in CI on Windows and Linux. Longer soak duration is
explicitly configurable and must not become a hidden retry loop or a second
scheduler inside production code.

## Real Electron release authority

Core Lite 4.8 promotes the desktop process boundary into the release contract.
A deterministic Playwright harness reloads and destroys Renderer windows while
a long final response is streaming, restarts Electron with the same `userData`,
and verifies both completed-run persistence and active-run cancellation recovery.
The harness is test-only and does not add a production control API.

Windows and Linux produce schema-versioned lifecycle and Electron evidence. A
final CI job verifies both suites for both platforms, hashes the evidence and
`package-lock.json`, and emits the Core Lite release-candidate summary. Generated
reports are excluded from Git and source archives but may remain in a local
working tree without violating the runtime architecture boundary.

## Distribution and update authority

Core Lite 4.9 separates runtime authority from distribution authority.
`rendererTarget.js` resolves Vite only in development and the exact packaged
`dist/index.html` entry in production. `UpdateService` is the single bounded
auto-update state machine; it is disabled outside packaged builds and exposes
only sanitized state through IPC.

`electron-builder.yml` owns application identity and platform targets. The
release workflow owns tag/version equality, code signing, macOS notarization,
platform update metadata, checksums, provenance and immutable GitHub Release
publication. An unsigned manual build is a private CI artifact only and cannot
become an update source.
