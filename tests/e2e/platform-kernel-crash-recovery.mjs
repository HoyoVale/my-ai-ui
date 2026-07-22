import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  spawnSync
} from "node:child_process";

import {
  fileURLToPath
} from "node:url";

import {
  PlatformKernel
} from "../../electron/platform/PlatformKernel.js";

const childFlag = process.argv[2];
const childDirectory = process.argv[3];

if (childFlag === "--child") {
  const kernel = new PlatformKernel({
    getStorageDirectory: () => childDirectory,
    leaseTtlMs: 60_000
  });
  const execution = kernel.prepareExecution({
    conversationId: "conversation-crash",
    goal: {
      id: "goal-crash",
      revision: 1,
      objective: "验证平台进程崩溃恢复"
    },
    agentRunId: "agent-crash",
    taskId: "task-crash",
    workspaceResource: "workspace:/crash-recovery",
    mode: "coding"
  });
  if (!execution.ok) process.exit(24);
  process.exit(23);
}

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "my-ai-ui-platform-crash-")
);
const child = spawnSync(
  process.execPath,
  [fileURLToPath(import.meta.url), "--child", directory],
  { stdio: "inherit" }
);
assert.equal(child.status, 23);

const recoveredKernel = new PlatformKernel({
  getStorageDirectory: () => directory,
  leaseTtlMs: 60_000
});
const recovery = recoveredKernel.recoverInterruptedRuns();
assert.equal(recovery.ok, true);
assert.deepEqual(recovery.recoveredAgentRunIds, ["agent-crash"]);

const restored = recoveredKernel.getSnapshot().runs.find(
  (run) => run.goalId === "goal-crash"
);
assert.equal(restored.status, "continuable");
assert.equal(restored.taskCounts.continuable, 1);
assert.equal(restored.agentCounts.interrupted, 1);
assert.equal(recoveredKernel.getSnapshot().activeLeases.length, 0);

console.log("Platform Kernel crash recovery E2E passed.");
