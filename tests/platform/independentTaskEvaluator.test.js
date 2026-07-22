import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { IndependentTaskEvaluator } from "../../electron/platform/IndependentTaskEvaluator.js";
import { MultiAgentSupervisor } from "../../electron/platform/MultiAgentSupervisor.js";
import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";
import { WorktreeRuntime } from "../../electron/platform/WorktreeRuntime.js";

function normalizeLineEndings(value) {
  return String(value).replace(/\r\n/gu, "\n");
}

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-evaluator-repo-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "baseline");
  return root;
}

function harness(evaluatorExecute) {
  const root = repository();
  const platformDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-evaluator-platform-"));
  const worktreeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-evaluator-worktrees-"));
  const kernel = new PlatformKernel({ getStorageDirectory: () => platformDirectory });
  const run = kernel.ensureRun({
    conversationId: "conversation",
    goalId: "goal",
    objective: "independent task evaluation",
    workspaceId: "workspace",
    mode: "coding"
  }).run;
  const worktrees = new WorktreeRuntime({
    getStorageDirectory: () => worktreeDirectory,
    platformKernel: kernel
  });
  const evaluatorRuntime = {
    resolveModel: () => ({ providerId: "evaluator-provider", modelConfigId: "evaluator-model" }),
    execute: evaluatorExecute
  };
  const evaluator = new IndependentTaskEvaluator({
    platformKernel: kernel,
    worktreeRuntime: worktrees,
    evaluatorRuntime,
    getWorkspaceRoot: () => root
  });
  const supervisor = new MultiAgentSupervisor({
    platformKernel: kernel,
    worktreeRuntime: worktrees,
    workerRuntime: {
      resolveModel: () => ({ providerId: "worker-provider", modelConfigId: "worker-model" }),
      async execute({ task, worktree }) {
        fs.writeFileSync(path.join(worktree.path, "implemented.txt"), "done\n");
        return {
          ok: true,
          summary: "implemented",
          evidence: ["worker-evidence"],
          acceptanceClaims: [{
            criterionId: task.acceptanceCriteria[0].id,
            passed: true,
            evidence: ["implemented.txt"]
          }]
        };
      }
    },
    taskEvaluator: evaluator,
    getWorkspaceRoot: () => root
  });
  return { root, kernel, run, supervisor };
}

describe("Independent Task Evaluator", () => {
  it("uses a distinct read-only AgentRun before completing the task", async () => {
    const { kernel, run, supervisor } = harness(async ({ worktree }) => {
      assert.equal(
        normalizeLineEndings(
          fs.readFileSync(path.join(worktree.path, "implemented.txt"), "utf8")
        ),
        "done\n"
      );
      return {
        ok: true,
        summary: JSON.stringify({
          approved: true,
          summary: "verified",
          evidence: ["implemented.txt"],
          criteria: [{
            criterionId: "criterion",
            passed: true,
            evidence: ["implemented.txt"]
          }]
        })
      };
    });
    supervisor.addTasks(run.id, [{
      id: "implementation",
      title: "Implementation",
      role: "implementer",
      maxAttempts: 1,
      acceptanceCriteria: [{ id: "criterion", text: "File exists" }]
    }]);

    const result = await supervisor.run(run.id);
    assert.equal(result.completed, true);
    const latest = kernel.getRun(run.id);
    assert.equal(latest.tasks.implementation.status, "completed");
    assert.equal(latest.tasks.implementation.evaluation.approved, true);
    const agents = Object.values(latest.agentRuns);
    const worker = agents.find((agent) => agent.kind === "worker");
    const evaluator = agents.find((agent) => agent.kind === "evaluator");
    assert.equal(Boolean(worker), true);
    assert.equal(Boolean(evaluator), true);
    assert.notEqual(worker.id, evaluator.id);
    assert.deepEqual(evaluator.modelSelection, {
      providerId: "evaluator-provider",
      modelConfigId: "evaluator-model"
    });
    assert.equal(latest.tasks.implementation.evaluation.workerAgentRunId, worker.id);
    assert.equal(latest.tasks.implementation.evaluation.evaluatorAgentRunId, evaluator.id);
  });

  it("rejects an approval that omits criterion evidence", async () => {
    const { kernel, run, supervisor } = harness(async () => ({
      ok: true,
      summary: JSON.stringify({
        approved: true,
        summary: "claimed only",
        criteria: [{ criterionId: "criterion", passed: true, evidence: [] }]
      })
    }));
    supervisor.addTasks(run.id, [{
      id: "implementation",
      title: "Implementation",
      role: "implementer",
      maxAttempts: 1,
      acceptanceCriteria: [{ id: "criterion", text: "Evidence is required" }]
    }]);

    const result = await supervisor.run(run.id);
    assert.equal(result.completed, false);
    const task = kernel.getRun(run.id).tasks.implementation;
    assert.equal(task.status, "continuable");
    assert.equal(task.evaluation.approved, false);
    assert.equal(task.integrationStatus, "blocked");
    assert.equal(
      task.evaluation.findings.includes("acceptance-criterion-unverified:criterion"),
      true
    );
  });
});
