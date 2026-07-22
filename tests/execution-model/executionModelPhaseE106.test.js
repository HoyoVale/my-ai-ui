import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";
import {
  sanitizePlatformExecutionBridge,
  validatePlatformExecutionBridge
} from "../../electron/execution-model/PlatformExecutionBridge.js";

function directory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "my-ai-ui-platform-bridge-"));
}

function harness(storage = directory()) {
  let identity = 0;
  let current = 1_000;
  return {
    storage,
    kernel: new PlatformKernel({
      getStorageDirectory: () => storage,
      createId: () => `bridge-id-${++identity}`,
      now: () => current
    }),
    advance(ms = 1) {
      current += ms;
    }
  };
}

function runInput(overrides = {}) {
  return {
    conversationId: "conversation-bridge",
    goalId: "goal-bridge",
    goalRevision: 1,
    objective: "bridge platform agents into explicit child threads",
    workspaceId: "workspace-bridge",
    mode: "coding",
    ...overrides
  };
}

describe("Execution Model 2.0 Phase E Platform Bridge", () => {
  it("migrates a legacy Platform Run with AgentRuns but no execution bridge", () => {
    const legacy = {
      version: 2,
      id: "legacy-platform-run",
      conversationId: "conversation-legacy",
      goalId: "goal-legacy",
      objective: "legacy bridge migration",
      workspaceId: "workspace-legacy",
      mode: "coding",
      status: "active",
      tasks: {
        task: { id: "task", title: "Legacy task" }
      },
      agentRuns: {
        worker: {
          version: 2,
          id: "worker",
          taskId: "task",
          role: "implementer",
          kind: "worker",
          status: "completed",
          startedAt: 10,
          endedAt: 20
        }
      },
      artifacts: [],
      evidence: [],
      reviews: [],
      createdAt: 1,
      updatedAt: 20
    };
    legacy.executionBridge = sanitizePlatformExecutionBridge(null, legacy);
    const validation = validatePlatformExecutionBridge(legacy);
    assert.equal(validation.ok, true);
    assert.equal(validation.bridge.children.length, 1);
    assert.equal(validation.bridge.children[0].status, "completed");
    assert.equal(validation.bridge.children[0].runs[0].state, "completed");
    assert.ok(legacy.agentRuns.worker.executionThreadId);
    assert.ok(legacy.agentRuns.worker.executionRunId);
  });

  it("creates one Supervisor thread and one child thread per AgentRun", () => {
    const value = harness();
    const prepared = value.kernel.prepareExecution({
      conversationId: "conversation-bridge",
      goal: {
        id: "goal-bridge",
        revision: 1,
        objective: "bridge main execution"
      },
      agentRunId: "main-agent",
      taskId: "main-task",
      workspaceId: "workspace-bridge",
      mode: "coding"
    });
    assert.equal(prepared.ok, true);

    const bridge = value.kernel.getExecutionBridge(prepared.platformRunId);
    assert.equal(bridge.supervisor.kind, "supervisor");
    assert.equal(bridge.supervisor.childThreadIds.length, 1);
    assert.equal(bridge.children.length, 1);
    assert.equal(bridge.children[0].agentRunId, "main-agent");
    assert.equal(bridge.children[0].kind, "worker");
    assert.equal(bridge.children[0].runs.length, 1);
    assert.equal(bridge.children[0].runs[0].threadId, bridge.children[0].id);
    assert.equal(value.kernel.validateExecutionBridge(prepared.platformRunId).ok, true);
  });

  it("maps Worker, Evaluator, Integrator and Reviewer roles without changing Task authority", () => {
    const value = harness();
    const run = value.kernel.ensureRun(runInput()).run;

    value.kernel.addTask(run.id, { taskId: "worker-task", title: "Worker", role: "implementer" });
    value.kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "worker-agent",
      taskId: "worker-task",
      role: "implementer",
      kind: "worker"
    });

    value.kernel.addTask(run.id, { taskId: "evaluation-task", title: "Evaluation", role: "implementer" });
    value.kernel.setTaskStatus(run.id, "evaluation-task", "running", "worker-complete");
    value.kernel.setTaskStatus(run.id, "evaluation-task", "review", "independent-evaluation");
    value.kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "evaluator-agent",
      taskId: "evaluation-task",
      role: "evaluator",
      kind: "evaluator"
    });

    value.kernel.addTask(run.id, { taskId: "integration-task", title: "Integration", role: "integrator" });
    value.kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "integrator-agent",
      taskId: "integration-task",
      role: "integrator"
    });

    value.kernel.addTask(run.id, { taskId: "review-task", title: "Review", role: "reviewer" });
    value.kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "reviewer-agent",
      taskId: "review-task",
      role: "reviewer"
    });

    const bridge = value.kernel.getExecutionBridge(run.id);
    const kinds = Object.fromEntries(bridge.children.map((thread) => [thread.agentRunId, thread.kind]));
    assert.deepEqual(kinds, {
      "worker-agent": "worker",
      "evaluator-agent": "evaluator",
      "integrator-agent": "integrator",
      "reviewer-agent": "reviewer"
    });
    assert.equal(value.kernel.getRun(run.id).tasks["worker-task"].status, "running");
    assert.equal(value.kernel.getRun(run.id).tasks["evaluation-task"].status, "review");
    assert.equal(value.kernel.validateExecutionBridge(run.id).ok, true);
  });

  it("keeps retries as distinct AgentRun child threads", () => {
    const value = harness();
    const run = value.kernel.ensureRun(runInput()).run;
    value.kernel.addTask(run.id, {
      taskId: "retry-task",
      title: "Retry task",
      role: "implementer",
      maxAttempts: 2
    });
    value.kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "worker-attempt-1",
      taskId: "retry-task",
      role: "implementer"
    });
    value.kernel.finishAgentRun(run.id, "worker-attempt-1", {
      status: "failed",
      stopReason: "first-attempt-failed",
      taskStatus: "continuable"
    });
    value.kernel.setTaskStatus(run.id, "retry-task", "ready", "retry");
    value.kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "worker-attempt-2",
      taskId: "retry-task",
      role: "implementer"
    });

    const bridge = value.kernel.getExecutionBridge(run.id);
    const attempts = bridge.children.filter((thread) => thread.taskId === "retry-task");
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[0].id, attempts[1].id);
    assert.notEqual(attempts[0].runs[0].id, attempts[1].runs[0].id);
    assert.equal(attempts.find((thread) => thread.agentRunId === "worker-attempt-1").status, "failed");
    assert.equal(attempts.find((thread) => thread.agentRunId === "worker-attempt-2").status, "running");
  });

  it("recovers a running child thread as continuable without replaying the AgentRun", () => {
    const first = harness();
    const run = first.kernel.ensureRun(runInput()).run;
    first.kernel.addTask(run.id, { taskId: "crash-task", title: "Crash recovery" });
    first.kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "crashed-worker",
      taskId: "crash-task",
      role: "implementer"
    });

    const second = harness(first.storage);
    const recovery = second.kernel.recoverInterruptedRuns();
    assert.deepEqual(recovery.recoveredAgentRunIds, ["crashed-worker"]);
    const thread = second.kernel.getAgentExecutionThread(run.id, "crashed-worker");
    assert.equal(thread.status, "continuable");
    assert.equal(thread.runs[0].state, "continuable");
    assert.equal(second.kernel.getRun(run.id).agentRuns["crashed-worker"].status, "interrupted");
    assert.equal(second.kernel.validateExecutionBridge(run.id).ok, true);
  });

  it("projects Integration, Review and Evidence trace without granting completion authority", () => {
    const value = harness();
    const run = value.kernel.ensureRun(runInput()).run;
    value.kernel.addTask(run.id, { taskId: "integration-task", title: "Integrate", role: "integrator" });
    value.kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "integrator-agent",
      taskId: "integration-task",
      role: "integrator"
    });
    const artifact = value.kernel.recordArtifact(run.id, {
      taskId: "integration-task",
      agentRunId: "integrator-agent",
      kind: "integration-result",
      digest: "integration-digest",
      changed: true
    }).artifact;
    value.kernel.recordIntegration(run.id, {
      status: "integrated",
      taskId: "integration-task",
      agentRunId: "integrator-agent",
      artifactIds: [artifact.id],
      digest: "integration-digest"
    });
    value.kernel.bindEvidence(run.id, {
      criterionId: "criterion-missing",
      artifactId: artifact.id
    });

    const bridge = value.kernel.getExecutionBridge(run.id);
    const integrator = bridge.children.find((thread) => thread.agentRunId === "integrator-agent");
    assert.deepEqual(integrator.trace.artifactIds, [artifact.id]);
    assert.equal(integrator.trace.integrationIds.length, 1);
    assert.equal(bridge.supervisor.completionFingerprint, null);

    const completion = value.kernel.authorizeCompletion({
      platformRunId: run.id,
      agentRunId: "integrator-agent",
      verification: { status: "incomplete", verified: false }
    });
    assert.equal(completion.ok, false);
    assert.equal(value.kernel.getRun(run.id).completionPermit, null);
  });
});
