import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";
import { WorktreeRuntime } from "../../electron/platform/WorktreeRuntime.js";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

const childFlag = process.argv[2];
const root = process.argv[3];

if (childFlag === "--child") {
  const repository = path.join(root, "repository");
  const kernel = new PlatformKernel({
    getStorageDirectory: () => path.join(root, "platform"),
    leaseTtlMs: 60_000
  });
  const run = kernel.ensureRun({
    conversationId: "conversation-crash",
    goalId: "goal-crash",
    objective: "recover a crashed worktree",
    workspaceId: "workspace",
    mode: "coding"
  }).run;
  kernel.addTask(run.id, {
    taskId: "task-crash",
    title: "write before crash"
  });
  kernel.beginAgentRun({
    platformRunId: run.id,
    agentRunId: "agent-crash",
    taskId: "task-crash",
    role: "implementer"
  });
  const runtime = new WorktreeRuntime({
    getStorageDirectory: () => path.join(root, "worktrees"),
    platformKernel: kernel
  });
  const created = runtime.create({
    platformRunId: run.id,
    agentRunId: "agent-crash",
    taskId: "task-crash",
    workspaceRoot: repository
  });
  if (!created.ok) process.exit(32);
  kernel.attachAgentWorktree(run.id, "agent-crash", created.worktree.id);
  fs.writeFileSync(path.join(created.worktree.path, "before-crash.txt"), "preserved\n");
  fs.writeFileSync(
    path.join(root, "metadata.json"),
    JSON.stringify({
      runId: run.id,
      worktreeId: created.worktree.id,
      branch: created.worktree.branch
    })
  );
  process.exit(31);
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-worktree-crash-"));
const repository = path.join(directory, "repository");
fs.mkdirSync(repository, { recursive: true });
git(repository, "init", "-b", "main");
git(repository, "config", "user.name", "Test");
git(repository, "config", "user.email", "test@example.invalid");
fs.writeFileSync(path.join(repository, "README.md"), "baseline\n");
git(repository, "add", "README.md");
git(repository, "commit", "-m", "baseline");

const child = spawnSync(
  process.execPath,
  [fileURLToPath(import.meta.url), "--child", directory],
  { stdio: "inherit" }
);
assert.equal(child.status, 31);
const metadata = JSON.parse(fs.readFileSync(path.join(directory, "metadata.json"), "utf8"));
const kernel = new PlatformKernel({
  getStorageDirectory: () => path.join(directory, "platform"),
  leaseTtlMs: 60_000
});
kernel.recoverInterruptedRuns();
const runtime = new WorktreeRuntime({
  getStorageDirectory: () => path.join(directory, "worktrees"),
  platformKernel: kernel
});
const recovery = runtime.recover();
assert.deepEqual(recovery.recoveredWorktreeIds, [metadata.worktreeId]);
const record = runtime.get(metadata.worktreeId);
assert.equal(record.status, "archived");
assert.equal(Boolean(record.checkpointCommit), true);
assert.equal(
  git(repository, "show", `${record.checkpointCommit}:before-crash.txt`),
  "preserved"
);
assert.equal(git(repository, "rev-parse", metadata.branch), record.checkpointCommit);

console.log("Worktree Runtime crash recovery E2E passed.");
