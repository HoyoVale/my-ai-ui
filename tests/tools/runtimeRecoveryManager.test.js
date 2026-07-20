import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";

import {
  ToolRegistry
} from "../../electron/tools/core/ToolRegistry.js";
import {
  RuntimeRecoveryManager
} from "../../electron/tools/runtime-state/RuntimeRecoveryManager.js";
import {
  ToolExecutionLedger
} from "../../electron/tools/runtime-state/ToolExecutionLedger.js";

function temporaryRoot() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "my-ai-ui-recovery-manager-")
  );
}

function remoteWriteDefinition() {
  const registry = new ToolRegistry();
  registry.register({
    name: "remote_write",
    title: "Remote write",
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.any(),
    sideEffect: "external",
    idempotency: "none",
    runtimeContract: {
      effect: "remote_write",
      retryMode: "reconcile_before_retry",
      supportsAbort: false
    },
    execute: async () => ({ ok: true })
  });
  return registry.get("remote_write");
}

test("startup recovery classifies an uncertain write and rebuilds its snapshot", async () => {
  const root = temporaryRoot();
  const runtimeDirectory = path.join(root, "task-1", "runtime");
  const ledger = new ToolExecutionLedger({
    directory: runtimeDirectory,
    taskId: "task-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    ownerId: "crashed-owner"
  });
  const prepared = await ledger.prepare({
    definition: remoteWriteDefinition(),
    input: { value: "one" },
    callId: "call-1",
    segmentId: "segment-1"
  });
  await ledger.recordRuntimeEvent("RUN_STARTED", {
    objective: "Write once"
  }, { runId: "run-1" });
  await ledger.markDispatched(prepared.call);
  await ledger.flush();

  const manager = new RuntimeRecoveryManager({
    rootDirectory: root,
    ownerId: "startup-owner"
  });
  const report = await manager.recoverAll();
  const decision = report.decisions[0];

  assert.equal(report.ok, true);
  assert.equal(report.recovered, 1);
  assert.equal(decision.outcome, "needs_reconciliation");
  assert.equal(decision.phase, "reconciling");
  assert.equal(decision.recovery.needsReconciliation, 1);
  assert.equal(decision.checkpoint.unresolvedCallIds[0], "call-1");
  assert.equal(decision.checkpoint.version, 3);

  const reopened = new ToolExecutionLedger({
    directory: runtimeDirectory,
    taskId: "task-1",
    runId: "run-2",
    workspaceId: "workspace-1"
  });
  assert.equal(
    reopened.developerSnapshot().calls[0].state,
    "needs_reconciliation"
  );
  assert.equal(reopened.loadCheckpoint().outcome, "needs_reconciliation");

  await reopened.close();
  await ledger.close();
});
