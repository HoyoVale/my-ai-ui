import assert from "node:assert/strict";
import test from "node:test";

import {
  createCheckpointInstruction,
  createRunCheckpoint
} from "../../electron/agent/runCheckpoint.js";

test("runtime checkpoints retain receipts and unresolved effects without raw diagnostics", () => {
  const checkpoint = createRunCheckpoint({
    taskId: "task-1",
    runId: "run-1",
    objective: "finish the task",
    toolRuntime: {
      version: 1,
      totalCalls: 2,
      receiptCount: 1,
      unresolvedCount: 1,
      needsConfirmation: 0,
      needsReconciliation: 1,
      calls: [
        {
          callId: "done",
          toolName: "read_file",
          state: "reported",
          recovery: "replay_receipt",
          effect: "read",
          hasReceipt: true,
          receiptId: "receipt-1",
          idempotencyKey: "secret-key"
        },
        {
          callId: "unknown",
          toolName: "remote_write",
          state: "needs_reconciliation",
          recovery: "needs_reconciliation",
          effect: "remote_write",
          hasReceipt: false,
          idempotencyKey: "secret-write-key"
        }
      ]
    }
  });

  assert.equal(checkpoint.version, 4);
  assert.equal(checkpoint.toolRuntime.unresolvedCount, 1);
  assert.equal(checkpoint.toolRuntime.calls.length, 2);
  assert.equal(checkpoint.toolRuntime.calls[0].idempotencyKey, undefined);
  assert.deepEqual(checkpoint.reportedReceiptIds, ["receipt-1"]);
  assert.deepEqual(checkpoint.unresolvedCallIds, ["unknown"]);
  assert.match(
    createCheckpointInstruction(checkpoint),
    /Do not repeat them automatically/
  );
});
