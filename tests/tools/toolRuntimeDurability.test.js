import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { z } from "zod";

import {
  ToolExecutor
} from "../../electron/tools/core/ToolExecutor.js";
import {
  ToolRegistry
} from "../../electron/tools/core/ToolRegistry.js";
import {
  ToolExecutionLedger
} from "../../electron/tools/runtime-state/ToolExecutionLedger.js";

function temporaryDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "my-ai-ui-runtime-")
  );
}

function definition(overrides = {}) {
  const registry = new ToolRegistry();
  registry.register({
    name: "durable_tool",
    title: "Durable tool",
    inputSchema: z.object({ value: z.number() }),
    outputSchema: z.object({
      ok: z.boolean(),
      data: z.object({ value: z.number() })
    }),
    sideEffect: "read",
    execute: async ({ value }) => ({
      ok: true,
      data: { value }
    }),
    ...overrides
  });
  return registry.get("durable_tool");
}

function ledger(directory, overrides = {}) {
  return new ToolExecutionLedger({
    directory,
    taskId: "task-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    ownerId: `owner-${Math.random()}`,
    ...overrides
  });
}

test("stores a receipt before reporting and replays it after restart", async () => {
  const directory = temporaryDirectory();
  let executions = 0;
  const tool = definition({
    execute: async ({ value }) => {
      executions += 1;
      return { ok: true, data: { value } };
    }
  });
  const firstLedger = ledger(directory);
  const firstExecutor = new ToolExecutor({
    executionLedger: firstLedger,
    context: {
      taskId: "task-1",
      workspaceId: "workspace-1",
      segmentId: "segment-1"
    }
  });

  const first = await firstExecutor.execute(
    tool,
    { value: 7 },
    { toolCallId: "call-stable", segmentId: "segment-1" }
  );
  assert.deepEqual(first, { ok: true, data: { value: 7 } });
  assert.equal(executions, 1);
  await firstLedger.close();

  const types = firstLedger.journal
    .eventsForCall("call-stable")
    .map((event) => event.type);
  assert.deepEqual(types, [
    "TOOL_PLANNED",
    "TOOL_PREPARED",
    "TOOL_DISPATCHED",
    "TOOL_RECEIPT_STORED",
    "TOOL_REPORTED"
  ]);

  const secondLedger = ledger(directory, { runId: "run-2" });
  const secondExecutor = new ToolExecutor({
    executionLedger: secondLedger,
    context: {
      taskId: "task-1",
      workspaceId: "workspace-1",
      segmentId: "segment-2"
    }
  });
  const replayed = await secondExecutor.execute(
    tool,
    { value: 7 },
    { toolCallId: "call-stable", segmentId: "segment-2" }
  );

  assert.deepEqual(replayed, first);
  assert.equal(executions, 1);
  const record = secondExecutor.getRecords().at(-1);
  assert.equal(record.runtime.replayed, true);
  assert.equal(record.runtime.recovery, "replay_receipt");
});

test("marks an uncertain remote write for reconciliation instead of blind retry", async () => {
  const directory = temporaryDirectory();
  let executions = 0;
  const tool = definition({
    sideEffect: "external",
    idempotency: "none",
    runtimeContract: {
      effect: "remote_write",
      retryMode: "reconcile_before_retry",
      supportsAbort: false
    },
    timeoutMs: 8,
    execute: async () => {
      executions += 1;
      return new Promise(() => {});
    }
  });
  const runtimeLedger = ledger(directory);
  const executor = new ToolExecutor({
    executionLedger: runtimeLedger,
    defaultTimeoutMs: 8,
    context: {
      taskId: "task-1",
      workspaceId: "workspace-1",
      segmentId: "segment-1"
    }
  });

  const output = await executor.execute(
    tool,
    { value: 1 },
    { toolCallId: "remote-call", segmentId: "segment-1" }
  );

  assert.equal(output.ok, false);
  assert.equal(output.error.code, "TOOL_EFFECT_UNKNOWN");
  assert.equal(executions, 1);
  const recovery = runtimeLedger.developerSnapshot();
  assert.equal(recovery.needsReconciliation, 1);
  assert.equal(recovery.calls[0].recovery, "needs_reconciliation");
  assert.equal(runtimeLedger.receipts.list().length, 0);

  const publicSnapshot = runtimeLedger.publicSnapshot();
  assert.equal(publicSnapshot.calls[0].idempotencyKey, undefined);
  assert.equal(
    runtimeLedger.developerSnapshot().calls[0].idempotencyKey,
    ""
  );
});

test("reconciles a previously dispatched write and turns it into a replayable receipt", async () => {
  const directory = temporaryDirectory();
  const first = ledger(directory);
  const tool = definition({
    sideEffect: "external",
    idempotency: "none",
    runtimeContract: {
      effect: "remote_write",
      retryMode: "reconcile_before_retry",
      reconcile: async ({ callId }) => ({
        status: "applied",
        output: {
          ok: true,
          data: { value: callId === "reconcile-call" ? 9 : 0 }
        },
        evidence: { remoteId: "remote-9" }
      })
    }
  });

  let prepared = await first.prepare({
    definition: tool,
    input: { value: 9 },
    callId: "reconcile-call",
    segmentId: "segment-1"
  });
  const dispatched = await first.markDispatched(prepared.call);
  await first.markUnknown(dispatched, { reason: "process crash" });
  await first.close();

  const recovered = ledger(directory, { runId: "run-2" });
  const result = await recovered.reconcile([tool]);
  assert.equal(result.results[0].status, "applied");
  assert.equal(result.recovery.unresolvedCount, 0);

  prepared = await recovered.prepare({
    definition: tool,
    input: { value: 9 },
    callId: "reconcile-call",
    segmentId: "segment-2"
  });
  assert.equal(prepared.replayed, true);
  assert.deepEqual(prepared.receipt.output, {
    ok: true,
    data: { value: 9 }
  });
});

test("recovers valid Journal entries around a truncated final record", async () => {
  const directory = temporaryDirectory();
  const runtimeLedger = ledger(directory);
  const tool = definition();
  const prepared = await runtimeLedger.prepare({
    definition: tool,
    input: { value: 3 },
    callId: "journal-call",
    segmentId: "segment-1"
  });
  await runtimeLedger.markDispatched(prepared.call);
  await runtimeLedger.flush();

  const journalFile = path.join(directory, "runtime-journal.jsonl");
  fs.appendFileSync(journalFile, '{"broken":', "utf8");

  const recovered = ledger(directory, { runId: "run-2" });
  const call = recovered.developerSnapshot().calls.find(
    (item) => item.callId === "journal-call"
  );
  assert.equal(call.state, "dispatched");
  assert.equal(call.recovery, "safe_to_retry");
});

test("manual recovery actions resolve uncertain calls without blind replay", async () => {
  const directory = temporaryDirectory();
  const runtimeLedger = ledger(directory);
  const tool = definition({
    sideEffect: "external",
    idempotency: "none",
    runtimeContract: {
      effect: "remote_write",
      retryMode: "manual_only"
    }
  });

  const prepared = await runtimeLedger.prepare({
    definition: tool,
    input: { value: 12 },
    callId: "manual-call",
    segmentId: "segment-1"
  });
  const dispatched = await runtimeLedger.markDispatched(prepared.call);
  await runtimeLedger.markUnknown(dispatched, { reason: "worker lost" });

  const unresolved = runtimeLedger.publicSnapshot().calls[0];
  assert.deepEqual(unresolved.actions, [
    "confirm_applied",
    "confirm_not_applied",
    "abandon"
  ]);

  const resolved = await runtimeLedger.resolveRecovery({
    callId: "manual-call",
    action: "confirm_applied",
    definitions: [tool]
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.recovery.unresolvedCount, 0);

  const replay = await runtimeLedger.prepare({
    definition: tool,
    input: { value: 12 },
    callId: "manual-call",
    segmentId: "segment-2"
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.output.data.manuallyConfirmed, true);
});

test("confirming an operation was not applied returns it to a retryable prepared state", async () => {
  const directory = temporaryDirectory();
  const runtimeLedger = ledger(directory);
  const tool = definition({
    sideEffect: "external",
    idempotency: "none",
    runtimeContract: {
      effect: "remote_write",
      retryMode: "reconcile_before_retry"
    }
  });

  const prepared = await runtimeLedger.prepare({
    definition: tool,
    input: { value: 4 },
    callId: "not-applied-call",
    segmentId: "segment-1"
  });
  const dispatched = await runtimeLedger.markDispatched(prepared.call);
  await runtimeLedger.markUnknown(dispatched, { reason: "unknown" });

  const resolved = await runtimeLedger.resolveRecovery({
    callId: "not-applied-call",
    action: "confirm_not_applied",
    definitions: [tool]
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.retryAllowed, true);
  assert.equal(
    runtimeLedger.developerSnapshot().calls[0].state,
    "prepared"
  );
});
