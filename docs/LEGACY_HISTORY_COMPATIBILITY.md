# Legacy History Compatibility

Core Lite keeps a one-way, read-only migration path for conversations created by
older Goal, Plan and Execution Thread builds.

## Canonical storage

Conversation-level history is stored only under:

```text
conversation.metadata.legacyAdvanced
```

Message-level historical Plan and Execution binding data is stored only under:

```text
message.metadata.legacyHistory
```

The normal Conversation API returns this canonical structure. It does not
recreate `conversation.goal`, `conversation.executionThread`, `message.plan`,
`message.planState` or other retired top-level aliases.

## Guarantees

- Historical data is bounded and JSON-safe.
- Migration is one-way and idempotent.
- Legacy data never enters model context or Runtime decisions.
- No mutation API exists for Goal, Plan or Execution Thread state.
- A JSON round trip cannot recreate retired root fields.
- Activity Timeline may render a historical Plan snapshot as ordinary history.

The compatibility files are deliberately limited to:

```text
electron/conversation/legacyGoalSnapshot.js
electron/conversation/legacyPlanSnapshot.js
electron/conversation/legacyExecutionSnapshot.js
electron/conversation/legacyConversationCompatibility.js
```
