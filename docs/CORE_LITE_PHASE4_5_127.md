# Core Lite 4.5 — Unified Terminal Presentation

## Goal

Unify Provider, Tool, recovery, cancellation and finalization exits without exposing raw diagnostics to ordinary users.

## Contract

Every completed run owns one `terminal` object:

```js
{
  version: 1,
  code,
  kind,
  title,
  message,
  action,
  outcome,
  stopReason,
  resumable
}
```

The object is produced only by `RunTerminalPresentation`, attached during `finalizeRun`, projected through Agent status, persisted under `message.metadata.run.terminal`, and copied into the Activity snapshot. Startup recovery uses the same resolver. Raw errors remain in developer diagnostics and Runtime Journal records.

## User states

- completed
- completed with local fallback
- cancelled
- needs input / blocked
- resumable checkpoint
- Tool confirmation / reconciliation required
- Provider configuration, quota, rate limit, timeout, network and availability errors
- Tool permission, invalid arguments, timeout and execution failures
- output limit and content filter

## UI

Response and Conversation use the terminal title instead of a generic “处理完成”. Attention states are distinct from successful completion.
