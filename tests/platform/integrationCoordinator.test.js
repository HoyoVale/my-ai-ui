import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { IntegrationCoordinator } from "../../electron/platform/IntegrationCoordinator.js";
import { MultiAgentSupervisor } from "../../electron/platform/MultiAgentSupervisor.js";
import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";
import { WorktreeRuntime } from "../../electron/platform/WorktreeRuntime.js";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/gu, "\n");
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-integration-repo-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "core.autocrlf", "true");
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "baseline");
  return root;
}

function harness({
  reviewApproved = true,
  conflict = false,
  changeDuringReview = false,
  onReviewExecute = null
} = {}) {
  const root = repository();
  const platformDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "xixi-integration-platform-")
  );
  const worktreeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "xixi-integration-worktrees-")
  );
  const kernel = new PlatformKernel({
    getStorageDirectory: () => platformDirectory
  });
  const execution = kernel.prepareExecution({
    conversationId: "conversation",
    goal: {
      id: "goal",
      revision: 1,
      objective: "integrate and review"
    },
    agentRunId: "main-agent",
    taskId: "main-task",
    workspaceId: "workspace",
    mode: "coding"
  });
  const worktrees = new WorktreeRuntime({
    getStorageDirectory: () => worktreeDirectory,
    platformKernel: kernel
  });
  const workerRuntime = {
    resolveModel: () => ({ providerId: "worker", modelConfigId: "worker-model" }),
    async execute({ task, worktree }) {
      const file = conflict ? "shared.txt" : `${task.id}.txt`;
      fs.writeFileSync(path.join(worktree.path, file), `${task.id}\n`);
      return { ok: true, summary: `implemented ${task.id}` };
    }
  };
  const supervisor = new MultiAgentSupervisor({
    platformKernel: kernel,
    worktreeRuntime: worktrees,
    workerRuntime,
    getWorkspaceRoot: () => root,
    maxConcurrency: 2
  });
  const reviewerRuntime = {
    resolveModel: () => ({ providerId: "reviewer", modelConfigId: "review-model" }),
    async execute(input) {
      onReviewExecute?.(input);
      if (changeDuringReview) {
        fs.writeFileSync(path.join(root, "concurrent.txt"), "user change\n");
      }
      return {
        ok: true,
        approved: reviewApproved,
        summary: reviewApproved ? "approved" : "scope risk remains",
        findings: reviewApproved ? [] : ["scope-risk"],
        evidence: ["final-diff-reviewed"]
      };
    }
  };
  let identity = 0;
  const coordinator = new IntegrationCoordinator({
    platformKernel: kernel,
    worktreeRuntime: worktrees,
    reviewerRuntime,
    getWorkspaceRoot: () => root,
    createId: () => `integration-agent-${++identity}`
  });
  return {
    root,
    kernel,
    platformRunId: execution.platformRunId,
    supervisor,
    coordinator
  };
}

describe("Integration Coordinator", () => {
  it("integrates Worker commits in an isolated branch and requires an independent approval", async () => {
    const value = harness();
    value.supervisor.addTasks(value.platformRunId, [
      { id: "alpha", title: "Alpha", role: "implementer" },
      { id: "beta", title: "Beta", role: "implementer" }
    ]);
    const workers = await value.supervisor.run(value.platformRunId, {
      taskIds: ["alpha", "beta"]
    });
    assert.equal(workers.completed, true);

    const result = await value.coordinator.integrateAndReview(value.platformRunId);
    assert.equal(result.ok, true);
    assert.equal(result.integration.status, "published");
    assert.equal(result.review.approved, true);
    assert.equal(readText(path.join(value.root, "alpha.txt")), "alpha\n");
    assert.equal(readText(path.join(value.root, "beta.txt")), "beta\n");
    assert.equal(git(value.root, "branch", "--show-current"), "main");
    assert.equal(git(value.root, "diff", "--cached", "--binary"), "");
    assert.equal(git(value.root, "show", `${result.integration.commit}:alpha.txt`), "alpha");
    assert.equal(git(value.root, "show", `${result.integration.commit}:beta.txt`), "beta");

    const run = value.kernel.getRun(value.platformRunId);
    const reviewer = run.agentRuns[result.review.agentRunId];
    assert.equal(reviewer.role, "reviewer");
    assert.notEqual(reviewer.id, run.artifacts.find((item) => item.taskId === "alpha").agentRunId);

    const completion = value.kernel.authorizeCompletion({
      platformRunId: value.platformRunId,
      agentRunId: "main-agent",
      verification: {
        version: 3,
        status: "verified",
        verified: true,
        checkedAt: 100,
        checks: [{ id: "tests", passed: true }]
      }
    });
    assert.equal(completion.ok, true);
    assert.equal(completion.permit.payload.integrationHash, result.integration.digest);
  });

  it("forwards cancellation and usage accounting through independent review", async () => {
    let reviewInput = null;
    const value = harness({
      onReviewExecute: (input) => {
        reviewInput = input;
      }
    });
    value.supervisor.addTasks(value.platformRunId, [
      { id: "alpha", title: "Alpha", role: "implementer" }
    ]);
    await value.supervisor.run(value.platformRunId, {
      taskIds: ["alpha"]
    });
    const controller = new AbortController();
    const usage = [];

    const result = await value.coordinator.integrateAndReview(
      value.platformRunId,
      {
        signal: controller.signal,
        onUsage: (entry) => usage.push(entry)
      }
    );

    assert.equal(result.ok, true);
    assert.equal(reviewInput.signal, controller.signal);
    assert.equal(typeof reviewInput.onUsage, "function");
    assert.deepEqual(usage, [{ tokens: 0, steps: 1 }]);
  });

  it("stops on a Git conflict without changing the user's worktree", async () => {
    const value = harness({ conflict: true });
    value.supervisor.addTasks(value.platformRunId, [
      { id: "alpha", title: "Alpha", role: "implementer" },
      { id: "beta", title: "Beta", role: "implementer" }
    ]);
    await value.supervisor.run(value.platformRunId, {
      taskIds: ["alpha", "beta"]
    });

    const result = await value.coordinator.integrateAndReview(value.platformRunId);
    assert.equal(result.ok, false);
    assert.equal(result.code, "integration-conflict");
    assert.deepEqual(result.conflicts, ["shared.txt"]);
    assert.equal(fs.existsSync(path.join(value.root, "shared.txt")), false);
    const run = value.kernel.getRun(value.platformRunId);
    assert.equal(run.integration.status, "conflicted");
    assert.equal(run.reviews.length, 0);
    assert.equal(run.tasks[run.integration.taskId].status, "blocked");
  });

  it("lets an independent Reviewer block completion", async () => {
    const value = harness({ reviewApproved: false });
    value.supervisor.addTasks(value.platformRunId, [
      { id: "alpha", title: "Alpha", role: "implementer" }
    ]);
    await value.supervisor.run(value.platformRunId, { taskIds: ["alpha"] });
    const result = await value.coordinator.integrateAndReview(value.platformRunId);
    assert.equal(result.ok, false);
    assert.equal(result.code, "independent-review-rejected");
    assert.equal(result.review.approved, false);

    const completion = value.kernel.authorizeCompletion({
      platformRunId: value.platformRunId,
      agentRunId: "main-agent",
      verification: {
        version: 3,
        status: "verified",
        verified: true,
        checkedAt: 100,
        checks: []
      }
    });
    assert.equal(completion.ok, false);
    assert.equal(completion.code, "platform-independent-review-required");
    assert.equal(value.kernel.getRun(value.platformRunId).tasks["main-task"].status, "running");
  });

  it("refuses publication when the user workspace changes during review", async () => {
    const value = harness({ changeDuringReview: true });
    value.supervisor.addTasks(value.platformRunId, [
      { id: "alpha", title: "Alpha", role: "implementer" }
    ]);
    await value.supervisor.run(value.platformRunId, { taskIds: ["alpha"] });
    const result = await value.coordinator.integrateAndReview(value.platformRunId);
    assert.equal(result.ok, false);
    assert.equal(result.code, "integration-target-changed");
    assert.equal(result.integration.status, "conflicted");
    assert.equal(fs.existsSync(path.join(value.root, "alpha.txt")), false);
    assert.equal(
      fs.readFileSync(path.join(value.root, "concurrent.txt"), "utf8"),
      "user change\n"
    );
  });
});
