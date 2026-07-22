import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { MultiAgentSupervisor } from "../../electron/platform/MultiAgentSupervisor.js";
import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";
import { WorktreeRuntime } from "../../electron/platform/WorktreeRuntime.js";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-agents-repo-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "baseline");
  return root;
}

describe("Multi-Agent Supervisor", () => {
  it("runs independent workers concurrently and waits for dependencies", async () => {
    const root = repository();
    const platformDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "xixi-agent-platform-")
    );
    const worktreeDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "xixi-agent-worktrees-")
    );
    const kernel = new PlatformKernel({
      getStorageDirectory: () => platformDirectory
    });
    const run = kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      objective: "parallel implementation",
      workspaceId: "workspace",
      mode: "coding"
    }).run;
    const worktrees = new WorktreeRuntime({
      getStorageDirectory: () => worktreeDirectory,
      platformKernel: kernel
    });
    let active = 0;
    let maximum = 0;
    const starts = [];
    const workerRuntime = {
      resolveModel: () => ({
        providerId: "worker-provider",
        modelConfigId: "worker-model"
      }),
      async execute({ task, worktree }) {
        active += 1;
        maximum = Math.max(maximum, active);
        starts.push(task.id);
        if (task.role === "implementer") {
          fs.writeFileSync(
            path.join(worktree.path, `${task.id}.txt`),
            `${task.id}\n`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return {
          ok: true,
          summary: `completed ${task.id}`,
          evidence: [`evidence ${task.id}`]
        };
      }
    };
    const supervisor = new MultiAgentSupervisor({
      platformKernel: kernel,
      worktreeRuntime: worktrees,
      workerRuntime,
      getWorkspaceRoot: () => root,
      maxConcurrency: 2
    });
    assert.equal(supervisor.addTasks(run.id, [
      { taskId: "alpha", id: "alpha", title: "Alpha", role: "implementer" },
      { taskId: "beta", id: "beta", title: "Beta", role: "implementer" },
      {
        taskId: "verify",
        id: "verify",
        title: "Verify",
        role: "tester",
        dependencies: ["alpha", "beta"]
      }
    ]).ok, true);

    const result = await supervisor.run(run.id);
    assert.equal(result.completed, true);
    assert.equal(maximum, 2);
    assert.deepEqual(new Set(starts.slice(0, 2)), new Set(["alpha", "beta"]));
    assert.equal(starts[2], "verify");
    const latest = kernel.getRun(run.id);
    assert.equal(latest.tasks.alpha.status, "completed");
    assert.equal(latest.tasks.beta.status, "completed");
    assert.equal(latest.tasks.verify.status, "completed");
    assert.equal(Object.values(latest.agentRuns).length, 3);
    for (const agent of Object.values(latest.agentRuns)) {
      assert.deepEqual(agent.modelSelection, {
        providerId: "worker-provider",
        modelConfigId: "worker-model"
      });
      assert.equal(Boolean(agent.handoff), true);
    }
    assert.equal(latest.artifacts.length, 3);
    assert.equal(fs.existsSync(path.join(root, "alpha.txt")), false);
  });

  it("retries a failed Worker within the task attempt limit", async () => {
    const root = repository();
    const platformDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-retry-platform-"));
    const worktreeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-retry-worktrees-"));
    const kernel = new PlatformKernel({ getStorageDirectory: () => platformDirectory });
    const run = kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      objective: "retry worker",
      workspaceId: "workspace",
      mode: "coding"
    }).run;
    let calls = 0;
    const supervisor = new MultiAgentSupervisor({
      platformKernel: kernel,
      worktreeRuntime: new WorktreeRuntime({
        getStorageDirectory: () => worktreeDirectory,
        platformKernel: kernel
      }),
      workerRuntime: {
        resolveModel: () => ({ providerId: "p", modelConfigId: "m" }),
        async execute() {
          calls += 1;
          return calls === 1
            ? { ok: false, status: "failed", error: "temporary" }
            : { ok: true, summary: "recovered" };
        }
      },
      getWorkspaceRoot: () => root
    });
    supervisor.addTasks(run.id, [{
      id: "retry",
      taskId: "retry",
      title: "Retry",
      maxAttempts: 2
    }]);
    const result = await supervisor.run(run.id);
    assert.equal(result.completed, true);
    assert.equal(calls, 2);
    assert.equal(kernel.getRun(run.id).tasks.retry.attemptCount, 2);
  });

  it("reports Worker usage at each completed task instead of after the whole workflow", async () => {
    const root = repository();
    const platformDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "xixi-usage-platform-")
    );
    const worktreeDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "xixi-usage-worktrees-")
    );
    const kernel = new PlatformKernel({
      getStorageDirectory: () => platformDirectory
    });
    const run = kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      objective: "meter workers",
      workspaceId: "workspace",
      mode: "coding"
    }).run;
    const supervisor = new MultiAgentSupervisor({
      platformKernel: kernel,
      worktreeRuntime: new WorktreeRuntime({
        getStorageDirectory: () => worktreeDirectory,
        platformKernel: kernel
      }),
      workerRuntime: {
        resolveModel: () => ({ providerId: "p", modelConfigId: "m" }),
        async execute({ task }) {
          return {
            ok: true,
            summary: task.id,
            usage: { totalTokens: 7, steps: 2 }
          };
        }
      },
      getWorkspaceRoot: () => root
    });
    supervisor.addTasks(run.id, [
      { id: "one", title: "One", role: "tester" },
      { id: "two", title: "Two", role: "tester" }
    ]);
    const usage = [];
    const result = await supervisor.run(run.id, {
      onUsage: (entry) => usage.push(entry)
    });

    assert.equal(result.completed, true);
    assert.deepEqual(usage, [
      { tokens: 7, steps: 2 },
      { tokens: 7, steps: 2 }
    ]);
  });

  it("stops before a dependent Worker when incremental usage exhausts the budget", async () => {
    const root = repository();
    const platformDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "xixi-budget-platform-")
    );
    const worktreeDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "xixi-budget-worktrees-")
    );
    const kernel = new PlatformKernel({
      getStorageDirectory: () => platformDirectory
    });
    const run = kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      objective: "stop on budget",
      workspaceId: "workspace",
      mode: "coding"
    }).run;
    const calls = [];
    const supervisor = new MultiAgentSupervisor({
      platformKernel: kernel,
      worktreeRuntime: new WorktreeRuntime({
        getStorageDirectory: () => worktreeDirectory,
        platformKernel: kernel
      }),
      workerRuntime: {
        resolveModel: () => ({ providerId: "p", modelConfigId: "m" }),
        async execute({ task }) {
          calls.push(task.id);
          return {
            ok: true,
            summary: task.id,
            usage: { totalTokens: 10, steps: 1 }
          };
        }
      },
      getWorkspaceRoot: () => root,
      maxConcurrency: 1
    });
    supervisor.addTasks(run.id, [
      { id: "first", title: "First", role: "tester" },
      { id: "second", title: "Second", role: "tester", dependencies: ["first"] }
    ]);
    const controller = new AbortController();

    const result = await supervisor.run(run.id, {
      signal: controller.signal,
      onUsage: () => controller.abort("budget-exceeded:tokens")
    });

    assert.equal(result.completed, false);
    assert.deepEqual(calls, ["first"]);
    assert.equal(kernel.getRun(run.id).tasks.first.status, "completed");
    assert.equal(kernel.getRun(run.id).tasks.second.status, "ready");
  });
});
