# Core Lite 4.8 Hotfix 133 — Conversation Detail Read

## Symptom

The real Electron release-candidate scenario completed the long response, but failed at the persistence assertion:

```text
false !== true
at tests/e2e/electron-release-candidate.cjs:239
```

## Root cause

`window.api.getConversationState()` returns a lightweight state summary. Its `currentConversation` contains summary fields such as `messageCount` and `preview`; it intentionally does not include the full `messages` array.

The release-candidate test incorrectly treated this summary as a full conversation record, so `assistantMessages()` always received an empty message list even when the assistant response had been persisted correctly.

## Resolution

The release-candidate flow now:

1. Reads `currentConversationId` from `getConversationState()`.
2. Loads the canonical conversation through `getConversation(currentConversationId)`.
3. Performs completed-run, restart-persistence, and cancelled-recovery assertions against the full conversation record.

The regression contract rejects direct reads from `currentConversation.messages` in the state-summary response.
