# Core Lite 3.6 P2

P2 closes the migration and naming boundary before Runtime stabilization.

Completed work:

- Conversation Schema v25 uses canonical metadata-only legacy history.
- Read APIs no longer project retired Goal, Plan or Execution aliases.
- Historical Plan UI reads `message.metadata.legacyHistory` and Activity events.
- Active Agent status no longer exposes a Plan field.
- `currentSegmentId` is renamed to `currentRunUnitId`.
- Runtime events use `RUN_UNIT_STARTED` and `RUN_UNIT_COMMITTED`.
- Checkpoint cursor uses `committedRunUnitId` and migrates old names.
- Dead `maxSegments` and `maxNoProgressSegments` settings are removed.
- Phase-specific tests are replaced by final Core Lite boundary contracts.
- Retired Goal, Plan and Execution architecture documents are removed.
