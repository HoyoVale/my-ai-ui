import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RUNTIME_CHECKPOINT_SCHEMA_VERSION
} from "../../electron/tools/runtime-state/RuntimeCheckpointSchema.js";
import {
  RuntimeCheckpointStore
} from "../../electron/tools/runtime-state/RuntimeCheckpointStore.js";
import {
  ToolExecutionLedger
} from "../../electron/tools/runtime-state/ToolExecutionLedger.js";

function temporaryDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "my-ai-ui-checkpoint-v4-")
  );
}

test("migrates legacy checkpoints and adds explicit recovery cursors", async () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(
    path.join(directory, "checkpoint.json"),
    JSON.stringify({
      version: 2,
      taskId: "task-1",
      runId: "run-1",
      workspaceId: "workspace-1",
      phase: "interrupted",
      outcome: "interrupted",
      resumable: true,
      committedSegmentId: "legacy-unit",
      updatedAt: 100
    }),
    "utf8"
  );

  const store = new RuntimeCheckpointStore({
    directory,
    taskId: "task-1",
    workspaceId: "workspace-1"
  });
  const detail = store.loadDetailed();

  assert.equal(detail.status, "migrated");
  assert.equal(
    detail.checkpoint.version,
    RUNTIME_CHECKPOINT_SCHEMA_VERSION
  );
  assert.equal(detail.checkpoint.committedRunUnitId, "legacy-unit");
  assert.equal(Object.hasOwn(detail.checkpoint, "committedSegmentId"), false);
  assert.equal(detail.checkpoint.journalSequence, 0);
  assert.deepEqual(detail.checkpoint.reportedReceiptIds, []);
  assert.deepEqual(detail.checkpoint.unresolvedCallIds, []);
  assert.equal(detail.checkpoint.integrity.checksum.length, 64);
});

test("rebuilds a damaged checkpoint from the latest Journal snapshot", async () => {
  const directory = temporaryDirectory();
  const ledger = new ToolExecutionLedger({
    directory,
    taskId: "task-1",
    runId: "run-1",
    workspaceId: "workspace-1"
  });

  await ledger.recordRuntimeEvent("RUN_STARTED", {
    objective: "Recover the task"
  }, { runId: "run-1" });
  await ledger.recordRuntimeEvent("RUN_UNIT_COMMITTED", {
    decision: "checkpoint"
  }, { runId: "run-1", segmentId: "segment-1" });
  const stored = await ledger.storeCheckpoint({
    version: 3,
    taskId: "task-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    objective: "Recover the task",
    phase: "checkpoint_ready",
    outcome: "continuable",
    resumable: true,
    publicStatus: "complete",
    plan: [{ id: "one", title: "Inspect", status: "completed" }],
    tools: [],
    toolRuntime: ledger.publicSnapshot(),
    updatedAt: 200
  });
  assert.equal(stored.committedRunUnitId, "segment-1");
  await ledger.flush();

  fs.writeFileSync(
    path.join(directory, "checkpoint.json"),
    "{damaged",
    "utf8"
  );

  const recovered = new ToolExecutionLedger({
    directory,
    taskId: "task-1",
    runId: "run-2",
    workspaceId: "workspace-1"
  });
  const checkpoint = await recovered.recoverCheckpoint();

  assert.equal(
    checkpoint.version,
    RUNTIME_CHECKPOINT_SCHEMA_VERSION
  );
  assert.equal(checkpoint.objective, "Recover the task");
  assert.equal(checkpoint.committedRunUnitId, "segment-1");
  assert.equal(checkpoint.snapshotSource, "journal-rebuild");
  assert.ok(
    fs.readdirSync(directory).some((name) =>
      name.startsWith("checkpoint.corrupt.")
    )
  );

  await recovered.close();
  await ledger.close();
});
