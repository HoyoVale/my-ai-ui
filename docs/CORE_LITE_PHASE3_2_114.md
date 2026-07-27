# Core Lite 3.2 — Conversation Schema v24

Core Lite 3.2 simplifies persisted Conversation data while preserving read-only access to historical Goal, Plan, Execution Thread, and routing records.

## Canonical Conversation

New and re-saved conversations persist only the Core Lite structure:

```js
{
  id,
  mode,
  workspaceId,
  workspaceSnapshot,
  skillId,
  skillSnapshot,
  skillIds,
  skillSnapshots,
  skillRoutingMode,
  modelSelection,
  modelSnapshot,
  metadata: {
    schema: "core-lite",
    version: 1,
    legacyAdvanced?
  },
  title,
  contextStartAfterMessageId,
  createdAt,
  updatedAt,
  messages
}
```

The following historical root fields are no longer canonical:

- `goal`
- `activeExecutionThreadId`
- `executionThreads`
- `executionThread`
- `routingDecisions`

When old data contains them, migration stores a sanitized snapshot under:

```js
conversation.metadata.legacyAdvanced
```

This envelope is explicitly marked `readOnly: true`.

## Canonical Message

Plan display data and run bindings are persisted under `message.metadata`:

```js
message.metadata = {
  plan?,
  planState?,
  taskId?,
  resumedFromMessageId?,
  legacyExecutionThreadId?,
  run?: {
    outcome?,
    phase?,
    resumable
  }
}
```

Legacy top-level aliases are not written back to storage.

## Read Compatibility

`projectConversationForRead()` and `projectMessageForRead()` recreate the old field names on cloned API results. Existing UI and diagnostic readers can therefore continue to display historical data without mutating canonical storage.

All Goal, Execution Thread, provider continuation, and routing mutation methods now return:

```js
{
  ok: false,
  code: "legacy-conversation-read-only"
}
```

## Runtime Recovery

Tool Runtime recovery history now resolves task identity from canonical `message.metadata.taskId`, with `activity.taskId` as a compatibility fallback. Public recovery results are projected before return.

## Validation

Run the phase contract with:

```bash
npm run test:core-lite3.2
```

The contract covers migration, JSON round-trip persistence, read projection, read-only mutation boundaries, Plan compatibility, Tool Runtime recovery history, routing metadata, and Run outcome compatibility.
