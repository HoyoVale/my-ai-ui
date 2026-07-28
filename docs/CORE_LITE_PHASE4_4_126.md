# Core Lite 4.4 — Checkpoint recovery consistency

Core Lite 4.4 makes continuation a validated operation rather than a best-effort reconstruction.

## Recovery order

```text
Locate latest resumable checkpoint
  → validate checkpoint version and runtime flavor
  → require all uncertain Tool effects to be resolved
  → validate Coding workspace identity
  → validate model provider/config/model identity
  → validate Skill snapshots and credentials
  → append the continuation message
  → reopen the task-scoped Tool ledger and receipts
  → reconcile persisted calls
  → start the resumed model run
```

A failed validation never appends a new user message and never starts a Provider request.

## Binding rules

- Coding continuation requires the original registered workspace to exist.
- A workspace ID that now points at another directory is rejected.
- The original model config may keep ordinary generation-setting edits, but it must still point to the same provider, config ID and underlying model ID.
- A removed or repointed model config blocks automatic continuation.
- Skill snapshot validation remains authoritative in `SkillRuntime`.

## Tool receipt rules

The same task ID reopens the same Tool result, Journal, receipt and call-state directories. Runtime reconciliation runs before `RUN_STARTED` or `RUN_RESUMED`.

If any call remains in `needs_confirmation`, `needs_reconciliation` or unknown recovery state, the model loop does not start. The run is persisted as recovery work and the user must resolve the Tool state first.

## Partial output

Checkpoint version 6 stores a bounded public partial response and its role. Startup recovery restores that text when the persisted assistant message is empty. Cancellation still honors `saveAbortedReplies`; disabled partial replies are not copied into the cancellation checkpoint.

## Compatibility

- Core Lite checkpoints up to version 6 are accepted.
- Future checkpoint versions are rejected rather than guessed.
- Tool Runtime checkpoint migration remains at its own schema version and synthesized checkpoints use the exported version constant.
- Legacy checkpoints without a model snapshot can continue only when their explicit model selection still exists.
