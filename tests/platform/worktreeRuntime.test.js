import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";
import { WorktreeRuntime } from "../../electron/platform/WorktreeRuntime.js";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8"
  }).trim();
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/gu, "\n");
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-worktree-repo-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "core.autocrlf", "true");
  fs.writeFileSync(path.join(root, "tracked.txt"), "baseline\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "-m", "baseline");
  return root;
}

describe("Worktree Runtime", () => {
  it("captures dirty state without changing the user's branch or index", () => {
    const root = repository();
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-worktrees-"));
    const platformStorage = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-platform-"));
    const kernel = new PlatformKernel({
      getStorageDirectory: () => platformStorage,
      createId: (() => {
        let id = 0;
        return () => `platform-${++id}`;
      })()
    });
    const run = kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      objective: "isolated work",
      mode: "coding"
    }).run;
    fs.writeFileSync(path.join(root, "tracked.txt"), "dirty tracked\n");
    fs.writeFileSync(path.join(root, "untracked.txt"), "dirty untracked\n");
    const statusBefore = git(root, "status", "--porcelain=v1", "--untracked-files=all");
    const indexBefore = git(root, "diff", "--cached", "--binary");
    const branchBefore = git(root, "branch", "--show-current");

    const runtime = new WorktreeRuntime({
      getStorageDirectory: () => storage,
      platformKernel: kernel,
      createId: () => "worktree-1"
    });
    const created = runtime.create({
      platformRunId: run.id,
      agentRunId: "agent-1",
      taskId: "task-1",
      workspaceRoot: root,
      role: "implementer"
    });
    assert.equal(created.ok, true);
    assert.equal(created.worktree.capturedDirtyState, true);
    assert.equal(
      readText(path.join(created.worktree.path, "tracked.txt")),
      "dirty tracked\n"
    );
    assert.equal(
      readText(path.join(created.worktree.path, "untracked.txt")),
      "dirty untracked\n"
    );
    assert.equal(git(root, "branch", "--show-current"), branchBefore);
    assert.equal(git(root, "diff", "--cached", "--binary"), indexBefore);
    assert.equal(
      git(root, "status", "--porcelain=v1", "--untracked-files=all"),
      statusBefore
    );

    fs.writeFileSync(path.join(created.worktree.path, "worker.txt"), "worker output\n");
    const checkpoint = runtime.checkpoint(created.worktree.id, "worker output");
    assert.equal(checkpoint.ok, true);
    assert.equal(checkpoint.changed, true);
    assert.equal(runtime.assertAgentPath("agent-1", "../escape").ok, false);
    const released = runtime.release(created.worktree.id);
    assert.equal(released.ok, true);
    assert.equal(released.removed, true);
    assert.equal(fs.existsSync(created.worktree.path), false);
    assert.equal(git(root, "rev-parse", created.worktree.branch), checkpoint.commit);
    assert.equal(
      git(root, "status", "--porcelain=v1", "--untracked-files=all"),
      statusBefore
    );
  });

  it("recovers an orphaned worktree without discarding its checkpoint branch", () => {
    const root = repository();
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-worktrees-"));
    const platformStorage = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-platform-"));
    const kernel = new PlatformKernel({
      getStorageDirectory: () => platformStorage
    });
    const run = kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      objective: "recover isolated work",
      mode: "coding"
    }).run;
    const runtime = new WorktreeRuntime({
      getStorageDirectory: () => storage,
      platformKernel: kernel
    });
    const created = runtime.create({
      platformRunId: run.id,
      agentRunId: "orphan-agent",
      taskId: "orphan-task",
      workspaceRoot: root
    });
    fs.writeFileSync(path.join(created.worktree.path, "recovered.txt"), "keep me\n");

    const recovery = runtime.recover();
    assert.deepEqual(recovery.recoveredWorktreeIds, [created.worktree.id]);
    const record = runtime.get(created.worktree.id);
    assert.equal(record.status, "archived");
    assert.equal(Boolean(record.checkpointCommit), true);
    assert.equal(git(root, "show", `${record.checkpointCommit}:recovered.txt`), "keep me");
  });

  it("publishes an integrated tree without changing the user branch or staged index", () => {
    const root = repository();
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-publish-worktrees-"));
    const platformStorage = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-publish-platform-"));
    const kernel = new PlatformKernel({ getStorageDirectory: () => platformStorage });
    const run = kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      objective: "publish reviewed integration",
      mode: "coding"
    }).run;
    fs.writeFileSync(path.join(root, "tracked.txt"), "user staged\n");
    git(root, "add", "tracked.txt");
    fs.writeFileSync(path.join(root, "local.txt"), "user untracked\n");
    const branchBefore = git(root, "branch", "--show-current");
    const indexBefore = git(root, "diff", "--cached", "--binary");
    const runtime = new WorktreeRuntime({
      getStorageDirectory: () => storage,
      platformKernel: kernel
    });
    const created = runtime.create({
      platformRunId: run.id,
      agentRunId: "integrator",
      taskId: "integration",
      workspaceRoot: root,
      role: "integrator"
    });
    fs.writeFileSync(path.join(created.worktree.path, "worker.txt"), "reviewed\n");
    const checkpoint = runtime.checkpoint(created.worktree.id, "reviewed integration");
    const published = runtime.publishIntegration({
      workspaceRoot: root,
      baselineCommit: created.worktree.baselineCommit,
      integrationCommit: checkpoint.commit
    });
    assert.equal(published.ok, true);
    assert.equal(readText(path.join(root, "worker.txt")), "reviewed\n");
    assert.equal(readText(path.join(root, "local.txt")), "user untracked\n");
    assert.equal(git(root, "branch", "--show-current"), branchBefore);
    assert.equal(git(root, "diff", "--cached", "--binary"), indexBefore);
  });
});
