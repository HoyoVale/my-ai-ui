# Core Lite 3.5 — Execution Model Physical Cleanup

Core Lite 3.5 removes the retired Execution Thread architecture from the runtime while keeping old conversation data readable.

## Production path

```text
AgentRuntime
  -> AgentRunSession
  -> CoreLiteRunLoop.runToCompletion()
  -> executeModelLoop()
  -> Tool / MCP / Skill / Memory
  -> final response or Core Lite checkpoint
```

The production path no longer imports or instantiates:

- `ExecutionThread`
- `RunEngine`
- `GoalCompletionVerifier`
- `LongTaskOrchestrator`
- `SegmentExecutionLoop`
- any module under `electron/execution-model`
- `ConversationExecutionService`
- `PlatformExecutionBridgeService`

`CoreLiteRunLoop` accepts `executeRun` only. The old segment callback aliases are removed.

## Historical conversation compatibility

Historical execution data is sanitized by:

```text
electron/conversation/legacyExecutionSnapshot.js
```

It is stored only under:

```js
conversation.metadata.legacyAdvanced.execution
```

Read APIs may project the old fields (`executionThread`, `executionThreads`, routing decisions) into cloned return values. They cannot be mutated and are never written back as canonical top-level fields.

New messages ignore `executionThreadId` input.

## Platform compatibility

New Platform runs and agent runs do not create:

- `executionBridge`
- `executionThreadId`
- `executionRunId`
- `parentExecutionThreadId`
- `executionKind`

The state projector removes these fields when loading an old Platform snapshot.

## Durable Tool data

Some Tool journal and receipt records still contain a field named `segmentId`. In Core Lite it is only a durable partition/correlation key for old Tool data. It is not an Execution Segment and has no orchestration authority.

## Baseline repair

`my-ai-ui(116)` restored 16 files that Core Lite 3.3 and 3.4 had already removed. Core Lite 3.5 deletes them again so the physical cleanup does not build on a regressed Goal/Plan baseline.
