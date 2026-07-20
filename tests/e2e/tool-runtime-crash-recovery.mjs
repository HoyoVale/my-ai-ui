import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  ToolRegistry
} from "../../electron/tools/core/ToolRegistry.js";
import {
  ToolExecutionLedger
} from "../../electron/tools/runtime-state/ToolExecutionLedger.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "my-ai-ui-crash-e2e-"));
const worker = fileURLToPath(
  new URL("../fixtures/runtime-crash-worker.mjs", import.meta.url)
);
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [worker, directory], {
    stdio: "inherit"
  });
  child.once("error", reject);
  child.once("exit", resolve);
});
assert.equal(exitCode, 91);
assert.equal(
  fs.readFileSync(path.join(directory, "remote-effect.txt"), "utf8"),
  "applied"
);

const registry = new ToolRegistry();
registry.register({
  name: "crash_write",
  title: "Crash write",
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
const tool = registry.get("crash_write");
const recovered = new ToolExecutionLedger({
  directory,
  taskId: "crash-task",
  runId: "recovery-run",
  workspaceId: "",
  ownerId: "recovery-worker"
});
assert.equal(recovered.publicSnapshot().needsReconciliation, 1);

const resolution = await recovered.resolveRecovery({
  callId: "crash-call",
  action: "confirm_applied",
  definitions: [tool]
});
assert.equal(resolution.ok, true);
assert.equal(resolution.recovery.unresolvedCount, 0);
await recovered.close();

const restarted = new ToolExecutionLedger({
  directory,
  taskId: "crash-task",
  runId: "restart-run",
  workspaceId: "",
  ownerId: "restart-worker"
});
const replay = await restarted.prepare({
  definition: tool,
  input: { value: "applied" },
  callId: "crash-call",
  segmentId: "segment-2"
});
assert.equal(replay.replayed, true);
assert.equal(replay.receipt.output.data.manuallyConfirmed, true);
await restarted.close();

console.log("Tool Runtime crash recovery E2E passed.");
