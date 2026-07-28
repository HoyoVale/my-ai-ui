# Core Lite 4.2 — Cancellation Consistency

Core Lite 4.2 makes cancellation one idempotent run transition shared by model streaming, Tool execution, approval waits, final-response streaming, persistence and startup recovery.

## Contract

```text
Stop request
  → AgentRunSession records one cancellation request
  → RunStateMachine enters cancelling
  → the shared AbortSignal stops model, Tool and approval work
  → partial text is preserved or discarded by the user setting
  → unresolved Tool effects override cancellation with recovery state
  → Response text and the persisted assistant message are reconciled once
  → the active run reaches one terminal state
```

## Important boundaries

- Repeated stop clicks return `already-cancelling` and do not create another terminalization path.
- A provider timeout that happens to use an `AbortError` is not treated as a user cancellation unless the run signal or session cancellation flag is active.
- Finalization checks the shared run signal while consuming the text stream, before flushing buffered public text, and before usage settlement.
- Pending Tool approvals are denied by the same AbortSignal.
- Cancellation Journal/checkpoint writes are best effort; a persistence failure cannot leave the UI and conversation message permanently running.
- If a cancelled run is found during startup before terminal persistence completed, it is recovered as cancelled and non-resumable. Uncertain writes still take precedence and enter reconciliation/confirmation.
- `saveAbortedReplies=false` discards provisional text, while the final public cancellation notice remains consistent in Response and Conversation.

## Validation

```powershell
npm run test:core-lite4.2
npm run check:full
```
