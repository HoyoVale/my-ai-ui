import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  describe,
  it
} from "node:test";

import {
  CompletionAuthority
} from "../../electron/platform/CompletionAuthority.js";

import {
  PlatformKernel
} from "../../electron/platform/PlatformKernel.js";

function createHarness(directory, { start = 1_000 } = {}) {
  let currentTime = start;
  let identity = 0;
  const now = () => currentTime;
  const authority = new CompletionAuthority({
    getKeyPath: () => path.join(directory, "completion.key"),
    now,
    randomBytes: () => Buffer.alloc(32, 7)
  });
  const kernel = new PlatformKernel({
    getStorageDirectory: () => directory,
    now,
    createId: () => `id-${++identity}`,
    leaseTtlMs: 5_000,
    completionAuthority: authority
  });
  return {
    kernel,
    authority,
    advance(milliseconds) {
      currentTime += milliseconds;
    }
  };
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "my-ai-ui-platform-"));
}

describe("Platform Kernel", () => {
  it("treats manual confirmation as evidence state instead of a Goal specification change", () => {
    const value = createHarness(temporaryDirectory());
    const run = value.kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      goalRevision: 1,
      objective: "manual verification",
      criteria: [
        { id: "tests", text: "tests pass", verificationKind: "test" },
        { id: "visual", text: "looks correct", verificationKind: "manual", manualSatisfied: false }
      ],
      mode: "coding"
    }).run;
    const artifact = value.kernel.recordArtifact(run.id, {
      kind: "tool-receipt",
      receiptIds: ["tests-pass"],
      digest: "tests-pass"
    }).artifact;
    assert.equal(value.kernel.bindEvidence(run.id, {
      criterionId: "tests",
      artifactId: artifact.id
    }).ok, true);

    const reused = value.kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      goalRevision: 1,
      objective: "manual verification",
      criteria: [
        { id: "tests", text: "tests pass", verificationKind: "test" },
        { id: "visual", text: "looks correct", verificationKind: "manual", manualSatisfied: true }
      ],
      mode: "coding"
    }).run;

    assert.equal(reused.id, run.id);
    assert.equal(reused.evidence.filter((item) => item.status === "valid").length, 1);
  });
  it("enforces task dependencies and promotes ready tasks", () => {
    const directory = temporaryDirectory();
    const { kernel } = createHarness(directory);
    const run = kernel.ensureRun({
      conversationId: "conversation-1",
      goalId: "goal-1",
      goalRevision: 2,
      objective: "实现平台内核",
      mode: "coding"
    }).run;

    assert.equal(kernel.addTask(run.id, {
      taskId: "task-a",
      title: "基础模型"
    }).task.status, "ready");
    assert.equal(kernel.addTask(run.id, {
      taskId: "task-b",
      title: "恢复",
      dependencies: ["task-a"]
    }).task.status, "pending");

    const rejected = kernel.setTaskStatus(run.id, "task-b", "running");
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "task-dependencies-unsettled");

    assert.equal(kernel.setTaskStatus(run.id, "task-a", "running").ok, true);
    assert.equal(kernel.setTaskStatus(run.id, "task-a", "completed").ok, true);
    assert.equal(kernel.getRun(run.id).tasks["task-b"].status, "ready");
  });

  it("prevents conflicting write leases and expires abandoned leases", () => {
    const directory = temporaryDirectory();
    const harness = createHarness(directory);
    const run = harness.kernel.ensureRun({
      conversationId: "conversation-1",
      goalId: "goal-1",
      objective: "隔离写入",
      mode: "coding"
    }).run;

    const first = harness.kernel.acquireLease({
      platformRunId: run.id,
      agentRunId: "agent-a",
      resourceKey: "workspace:/project",
      mode: "exclusive"
    });
    assert.equal(first.ok, true);

    const conflict = harness.kernel.acquireLease({
      platformRunId: run.id,
      agentRunId: "agent-b",
      resourceKey: "workspace:/project",
      mode: "exclusive"
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, "resource-lease-conflict");

    harness.advance(5_001);
    assert.deepEqual(harness.kernel.expireLeases(), [first.lease.id]);
    assert.equal(harness.kernel.acquireLease({
      platformRunId: run.id,
      agentRunId: "agent-b",
      resourceKey: "workspace:/project",
      mode: "exclusive"
    }).ok, true);
  });

  it("recovers an orphan task and lease from a crash between durable events", () => {
    const directory = temporaryDirectory();
    const first = createHarness(directory);
    const run = first.kernel.ensureRun({
      conversationId: "conversation-orphan",
      goalId: "goal-orphan",
      objective: "恢复事件间崩溃",
      mode: "coding"
    }).run;
    first.kernel.addTask(run.id, {
      taskId: "task-orphan",
      title: "未登记 Agent 的运行任务"
    });
    first.kernel.setTaskStatus(run.id, "task-orphan", "running");
    const lease = first.kernel.acquireLease({
      platformRunId: run.id,
      agentRunId: "agent-not-yet-journaled",
      resourceKey: "workspace:/orphan",
      mode: "exclusive",
      ttlMs: 60_000
    });
    assert.equal(lease.ok, true);

    const second = createHarness(directory);
    const recovery = second.kernel.recoverInterruptedRuns();
    assert.deepEqual(recovery.recoveredTaskIds, ["task-orphan"]);
    assert.equal(second.kernel.getRun(run.id).status, "continuable");
    assert.equal(second.kernel.getRun(run.id).tasks["task-orphan"].status, "continuable");
    assert.equal(second.kernel.getSnapshot().activeLeases.length, 0);
  });

  it("invalidates a running integration after restart", () => {
    const directory = temporaryDirectory();
    const first = createHarness(directory);
    const run = first.kernel.ensureRun({
      conversationId: "conversation-integration",
      goalId: "goal-integration",
      objective: "recover integration",
      mode: "coding"
    }).run;
    first.kernel.recordIntegration(run.id, {
      status: "running",
      taskId: "integration-task",
      agentRunId: "integrator",
      baselineCommit: "baseline",
      inputCommits: ["worker"]
    });

    const second = createHarness(directory);
    second.kernel.recoverInterruptedRuns();
    const recovered = second.kernel.getRun(run.id).integration;
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.error, "application-restart");
  });

  it("issues a bound completion permit only after verified settled work", () => {
    const directory = temporaryDirectory();
    const { kernel, authority } = createHarness(directory);
    const execution = kernel.prepareExecution({
      conversationId: "conversation-1",
      goal: {
        id: "goal-1",
        revision: 4,
        objective: "完成可验证内核"
      },
      agentRunId: "agent-1",
      taskId: "task-1",
      workspaceId: "workspace-1",
      workspaceResource: "workspace:/project",
      mode: "coding"
    });
    assert.equal(execution.ok, true);

    const rejected = kernel.authorizeCompletion({
      platformRunId: execution.platformRunId,
      agentRunId: "agent-1",
      verification: { status: "incomplete", verified: false }
    });
    assert.equal(rejected.code, "platform-completion-unverified");

    const authorized = kernel.authorizeCompletion({
      platformRunId: execution.platformRunId,
      agentRunId: "agent-1",
      verification: {
        version: 3,
        status: "verified",
        verified: true,
        checkedAt: 1_000,
        checks: [{ id: "test", passed: true, evidence: ["npm test"] }]
      },
      records: [{ id: "tool-1", name: "run_workspace_command", status: "completed" }]
    });
    assert.equal(authorized.ok, true);

    const run = kernel.getRun(execution.platformRunId);
    assert.equal(run.tasks["task-1"].status, "completed");
    assert.equal(run.agentRuns["agent-1"].status, "completed");
    assert.equal(
      authority.verify(authorized.permit, {
        goalId: "goal-1",
        goalRevision: 4,
        platformRunId: execution.platformRunId
      }).ok,
      true
    );
    assert.equal(kernel.setRunStatus(
      execution.platformRunId,
      "completed",
      "authorized"
    ).ok, true);

    const tampered = structuredClone(authorized.permit);
    tampered.payload.goalRevision = 5;
    assert.equal(authority.verify(tampered, {
      goalId: "goal-1",
      goalRevision: 5,
      platformRunId: execution.platformRunId
    }).ok, false);
  });

  it("refuses Goal completion when a changed Worker artifact bypassed task evaluation", () => {
    const directory = temporaryDirectory();
    const { kernel } = createHarness(directory);
    const run = kernel.ensureRun({
      conversationId: "conversation-evaluation-gate",
      goalId: "goal-evaluation-gate",
      objective: "require task evaluation",
      workspaceId: "workspace",
      mode: "coding"
    }).run;
    kernel.addTask(run.id, {
      taskId: "worker-task",
      title: "Worker task",
      role: "implementer"
    });
    kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "worker-agent",
      taskId: "worker-task",
      role: "implementer",
      kind: "worker"
    });
    kernel.recordAgentHandoff(run.id, "worker-agent", {
      inputRevision: 1,
      outputCommit: "worker-commit",
      summary: "claimed completion",
      evidence: ["claim"],
      unresolved: []
    });
    kernel.recordArtifact(run.id, {
      taskId: "worker-task",
      agentRunId: "worker-agent",
      kind: "git-commit",
      commit: "worker-commit",
      changed: true,
      digest: "worker-digest",
      summary: "changed output"
    });
    kernel.finishAgentRun(run.id, "worker-agent", {
      status: "completed",
      outcome: "claimed",
      taskStatus: "completed"
    });
    kernel.addTask(run.id, {
      taskId: "verifier-task",
      title: "Verifier",
      role: "reviewer",
      dependencies: ["worker-task"]
    });
    kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "verifier-agent",
      taskId: "verifier-task",
      role: "reviewer"
    });

    const rejected = kernel.authorizeCompletion({
      platformRunId: run.id,
      agentRunId: "verifier-agent",
      verification: {
        version: 1,
        status: "verified",
        verified: true,
        checks: []
      }
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "platform-task-evaluation-required");
    assert.deepEqual(rejected.taskIds, ["worker-task"]);
  });


  it("replays Journal after a corrupt snapshot and repairs a truncated tail", () => {
    const directory = temporaryDirectory();
    const first = createHarness(directory);
    const execution = first.kernel.prepareExecution({
      conversationId: "conversation-1",
      goal: {
        id: "goal-recovery",
        revision: 1,
        objective: "恢复未完成任务"
      },
      agentRunId: "agent-recovery",
      taskId: "task-recovery",
      workspaceResource: "workspace:/recovery",
      mode: "coding"
    });
    assert.equal(execution.ok, true);

    fs.writeFileSync(
      path.join(directory, "platform-snapshot.json"),
      "{broken snapshot",
      "utf8"
    );
    fs.appendFileSync(
      path.join(directory, "platform-journal.jsonl"),
      "{truncated-event",
      "utf8"
    );

    const second = createHarness(directory);
    const recovery = second.kernel.recoverInterruptedRuns();
    assert.equal(recovery.ok, true);
    assert.deepEqual(recovery.recoveredAgentRunIds, ["agent-recovery"]);
    assert.equal(recovery.journal.repairedTail, true);

    const restored = second.kernel.getRun(execution.platformRunId);
    assert.equal(restored.status, "continuable");
    assert.equal(restored.tasks["task-recovery"].status, "continuable");
    assert.equal(restored.agentRuns["agent-recovery"].status, "interrupted");
    assert.equal(
      fs.readdirSync(directory).some((name) =>
        name.startsWith("platform-journal.jsonl.corrupt.")
      ),
      true
    );
  });
});
