# Core Lite 3.4 — Plan Runtime Physical Cleanup

Core Lite 3.4 removes Plan as an Agent control system while preserving historical Plan content as read-only message metadata.

## Runtime boundary

The production path is now:

```text
AgentRunSession
  -> CoreLiteRunLoop
  -> Tool Runtime / MCP / Skill / Memory
  -> final response or resumable checkpoint
```

The runtime no longer owns a `RunPlanStore`, registers Plan mutation tools, gates tools by an active step, derives stop reasons from Plan state, or uses Plan completion to authorize the final answer.

## Removed modules

- `electron/agent/PlanAuthority.js`
- `electron/agent/planState.js`
- `electron/agent/orchestration/agentTools.js`
- `electron/config/coreLite.js`

The `update_plan`, `replan_goal`, and `update_step_work` tools and `agent.plan` capability are physically absent.

## Historical compatibility

Legacy `message.plan` and `message.planState` are migrated to:

```js
message.metadata.plan
message.metadata.planState
```

`metadata.planState.readOnly` is always true. Read projections may expose the old aliases for historical UI rendering, but new message writes ignore Plan fields and canonical JSON never restores top-level aliases.

## Dormant advanced compatibility

`LongTaskOrchestrator` and `SegmentExecutionLoop` remain only for later execution-thread cleanup. They no longer own a Plan, accept a Plan callback, emit a Plan checkpoint, or decide continuation from Plan status.

## Baseline repair

The `my-ai-ui(115)` archive accidentally reintroduced the old Goal Runtime and editable Goal UI files that Core Lite 3.3 had removed. Core Lite 3.4 restores that physical deletion boundary as part of the patch, so Plan cleanup is not layered on top of a regressed Goal implementation.
