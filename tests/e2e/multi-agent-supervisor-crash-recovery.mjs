import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MultiAgentSupervisor } from "../../electron/platform/MultiAgentSupervisor.js";
import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";
import { createStructuredHandoff } from "../../electron/platform/StructuredHandoff.js";
import { WorktreeRuntime } from "../../electron/platform/WorktreeRuntime.js";
import { sha256 } from "../../electron/platform/canonical.js";

function normalizeLineEndings(value) {
  return String(value).replace(/\r\n/gu, "\n");
}

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

const childFlag = process.argv[2];
const root = process.argv[3];

if (childFlag === "--checkpoint-only-child") {
  const repository = path.join(root, "repository");
  const kernel = new PlatformKernel({
    getStorageDirectory: () => path.join(root, "platform"),
    leaseTtlMs: 60_000
  });
  const run = kernel.ensureRun({
    conversationId: "conversation-checkpoint-crash",
    goalId: "goal-checkpoint-crash",
    objective: "recover checkpoint before handoff",
    workspaceId: "workspace",
    mode: "coding"
  }).run;
  kernel.addTaskGraph(run.id, [{
    id: "task-checkpoint-crash",
    title: "Checkpoint before handoff",
    role: "implementer"
  }]);
  kernel.beginAgentRun({
    platformRunId: run.id,
    agentRunId: "worker-checkpoint-crash",
    taskId: "task-checkpoint-crash",
    role: "implementer",
    kind: "worker"
  });
  const worktrees = new WorktreeRuntime({
    getStorageDirectory: () => path.join(root, "worktrees"),
    platformKernel: kernel
  });
  const created = worktrees.create({
    platformRunId: run.id,
    agentRunId: "worker-checkpoint-crash",
    taskId: "task-checkpoint-crash",
    workspaceRoot: repository,
    role: "implementer",
    writable: true
  });
  if (!created.ok) process.exit(47);
  kernel.attachAgentWorktree(run.id, "worker-checkpoint-crash", created.worktree.id);
  fs.writeFileSync(path.join(created.worktree.path, "checkpoint-only.txt"), "checkpointed\n");
  const checkpoint = worktrees.checkpoint(created.worktree.id, "checkpoint before handoff");
  if (!checkpoint.ok) process.exit(48);
  fs.writeFileSync(path.join(root, "checkpoint-metadata.json"), JSON.stringify({
    runId: run.id,
    taskId: "task-checkpoint-crash",
    worktreeId: created.worktree.id,
    checkpointCommit: checkpoint.commit
  }));
  process.exit(46);
}

if (childFlag === "--child") {
  const repository = path.join(root, "repository");
  const kernel = new PlatformKernel({
    getStorageDirectory: () => path.join(root, "platform"),
    leaseTtlMs: 60_000
  });
  const run = kernel.ensureRun({
    conversationId: "conversation-crash",
    goalId: "goal-crash",
    objective: "recover supervisor review boundary",
    workspaceId: "workspace",
    mode: "coding"
  }).run;
  kernel.addTaskGraph(run.id, [{
    id: "task-crash",
    title: "Checkpoint before evaluator",
    role: "implementer",
    maxAttempts: 2,
    acceptanceCriteria: [{ id: "checkpoint", text: "Checkpoint is recoverable" }],
    resourceLocks: [{ key: "shared-config", mode: "exclusive" }]
  }]);

  const taskLease = kernel.acquireLease({
    platformRunId: run.id,
    agentRunId: "worker-crash",
    resourceKey: `task:${run.id}:task-crash`,
    mode: "exclusive",
    ttlMs: 60_000
  });
  const resourceLease = kernel.acquireLease({
    platformRunId: run.id,
    agentRunId: "worker-crash",
    resourceKey: "shared-config",
    mode: "exclusive",
    ttlMs: 60_000
  });
  if (!taskLease.ok || !resourceLease.ok) process.exit(42);

  kernel.beginAgentRun({
    platformRunId: run.id,
    agentRunId: "worker-crash",
    taskId: "task-crash",
    role: "implementer",
    kind: "worker"
  });
  const worktrees = new WorktreeRuntime({
    getStorageDirectory: () => path.join(root, "worktrees"),
    platformKernel: kernel
  });
  const created = worktrees.create({
    platformRunId: run.id,
    agentRunId: "worker-crash",
    taskId: "task-crash",
    workspaceRoot: repository,
    role: "implementer",
    writable: true
  });
  if (!created.ok) process.exit(43);
  kernel.attachAgentWorktree(run.id, "worker-crash", created.worktree.id);
  fs.writeFileSync(path.join(created.worktree.path, "before-evaluator.txt"), "preserved\n");
  const checkpoint = worktrees.checkpoint(created.worktree.id, "checkpoint before evaluator");
  if (!checkpoint.ok) process.exit(44);

  const current = kernel.getRun(run.id);
  const handoff = createStructuredHandoff({
    run: current,
    task: current.tasks["task-crash"],
    agentRun: current.agentRuns["worker-crash"],
    checkpoint: {
      ...checkpoint,
      baselineCommit: created.worktree.baselineCommit
    },
    result: {
      ok: true,
      summary: "worker checkpointed",
      evidence: ["before-evaluator.txt"],
      acceptanceClaims: [{
        criterionId: "checkpoint",
        passed: true,
        evidence: ["before-evaluator.txt"]
      }]
    }
  });
  kernel.recordAgentHandoff(run.id, "worker-crash", handoff);
  kernel.recordArtifact(run.id, {
    taskId: "task-crash",
    agentRunId: "worker-crash",
    kind: "git-commit",
    commit: checkpoint.commit,
    changed: checkpoint.changed,
    digest: sha256({ commit: checkpoint.commit }),
    summary: "checkpoint before evaluator"
  });
  worktrees.release(created.worktree.id, {
    reason: "worker-awaiting-evaluation",
    remove: true
  });
  kernel.finishAgentRun(run.id, "worker-crash", {
    status: "completed",
    outcome: "handoff-recorded",
    stopReason: "task-awaiting-evaluation",
    taskStatus: "review"
  });
  fs.writeFileSync(path.join(root, "metadata.json"), JSON.stringify({
    runId: run.id,
    taskId: "task-crash",
    checkpointCommit: checkpoint.commit,
    handoffFingerprint: handoff.fingerprint
  }));
  process.exit(41);
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-supervisor-crash-"));
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
assert.equal(child.status, 41);
const metadata = JSON.parse(fs.readFileSync(path.join(directory, "metadata.json"), "utf8"));

const kernel = new PlatformKernel({
  getStorageDirectory: () => path.join(directory, "platform"),
  leaseTtlMs: 60_000
});
const recovery = kernel.recoverInterruptedRuns();
assert.equal(recovery.ok, true);
let restored = kernel.getRun(metadata.runId);
assert.equal(restored.status, "continuable");
assert.equal(restored.tasks[metadata.taskId].status, "continuable");
assert.equal(restored.tasks[metadata.taskId].checkpoint.commit, metadata.checkpointCommit);
assert.equal(
  restored.agentRuns["worker-crash"].handoff.fingerprint,
  metadata.handoffFingerprint
);
assert.equal(kernel.getSnapshot().activeLeases.length, 0);
assert.equal(
  git(repository, "show", `${metadata.checkpointCommit}:before-evaluator.txt`),
  "preserved"
);

const worktrees = new WorktreeRuntime({
  getStorageDirectory: () => path.join(directory, "worktrees"),
  platformKernel: kernel
});
worktrees.recover();
kernel.setTaskStatus(metadata.runId, metadata.taskId, "ready", "resume-after-restart");
const supervisor = new MultiAgentSupervisor({
  platformKernel: kernel,
  worktreeRuntime: worktrees,
  workerRuntime: {
    resolveModel: () => ({ providerId: "resume-provider", modelConfigId: "resume-model" }),
    async execute({ task, worktree }) {
      assert.equal(
        normalizeLineEndings(
          fs.readFileSync(path.join(worktree.path, "before-evaluator.txt"), "utf8")
        ),
        "preserved\n"
      );
      fs.writeFileSync(path.join(worktree.path, "after-restart.txt"), "resumed\n");
      return {
        ok: true,
        summary: "resumed from checkpoint",
        evidence: ["before-evaluator.txt", "after-restart.txt"],
        acceptanceClaims: [{
          criterionId: task.acceptanceCriteria[0].id,
          passed: true,
          evidence: ["before-evaluator.txt", "after-restart.txt"]
        }]
      };
    }
  },
  getWorkspaceRoot: () => repository,
  maxConcurrency: 1
});
const result = await supervisor.run(metadata.runId, { taskIds: [metadata.taskId] });
assert.equal(result.completed, true);
restored = kernel.getRun(metadata.runId);
assert.equal(restored.tasks[metadata.taskId].status, "completed");
assert.equal(restored.tasks[metadata.taskId].attemptCount, 2);
assert.equal(restored.tasks[metadata.taskId].evaluation.approved, true);
assert.equal(
  Object.values(restored.agentRuns).filter((agent) => agent.kind === "worker").length,
  2
);
assert.equal(
  Object.values(restored.agentRuns).filter((agent) => agent.kind === "evaluator").length,
  1
);
assert.equal(kernel.getSnapshot().activeLeases.length, 0);

console.log("Multi-Agent Supervisor crash recovery E2E passed.");


const checkpointDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "xixi-supervisor-checkpoint-crash-")
);
const checkpointRepository = path.join(checkpointDirectory, "repository");
fs.mkdirSync(checkpointRepository, { recursive: true });
git(checkpointRepository, "init", "-b", "main");
git(checkpointRepository, "config", "user.name", "Test");
git(checkpointRepository, "config", "user.email", "test@example.invalid");
fs.writeFileSync(path.join(checkpointRepository, "README.md"), "baseline\n");
git(checkpointRepository, "add", "README.md");
git(checkpointRepository, "commit", "-m", "baseline");
const checkpointChild = spawnSync(
  process.execPath,
  [fileURLToPath(import.meta.url), "--checkpoint-only-child", checkpointDirectory],
  { stdio: "inherit" }
);
assert.equal(checkpointChild.status, 46);
const checkpointMetadata = JSON.parse(
  fs.readFileSync(path.join(checkpointDirectory, "checkpoint-metadata.json"), "utf8")
);
const checkpointKernel = new PlatformKernel({
  getStorageDirectory: () => path.join(checkpointDirectory, "platform"),
  leaseTtlMs: 60_000
});
checkpointKernel.recoverInterruptedRuns();
const checkpointWorktrees = new WorktreeRuntime({
  getStorageDirectory: () => path.join(checkpointDirectory, "worktrees"),
  platformKernel: checkpointKernel
});
checkpointWorktrees.recover();
const checkpointRun = checkpointKernel.getRun(checkpointMetadata.runId);
assert.equal(checkpointRun.tasks[checkpointMetadata.taskId].status, "continuable");
assert.equal(
  checkpointRun.tasks[checkpointMetadata.taskId].checkpoint.commit,
  checkpointMetadata.checkpointCommit
);
assert.equal(
  git(checkpointRepository, "show", `${checkpointMetadata.checkpointCommit}:checkpoint-only.txt`),
  "checkpointed"
);
assert.equal(checkpointKernel.getSnapshot().activeLeases.length, 0);

console.log("Multi-Agent Supervisor pre-handoff checkpoint recovery passed.");
