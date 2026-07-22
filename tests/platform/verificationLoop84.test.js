import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  classifyPlatformFailure,
  FAILURE_TYPES
} from "../../electron/platform/FailureClassifier.js";
import { IndependentReplanner } from "../../electron/platform/IndependentReplanner.js";
import { PlatformJobScheduler } from "../../electron/platform/PlatformJobScheduler.js";
import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";

function harness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-verification-84-"));
  let identity = 0;
  const kernel = new PlatformKernel({
    getStorageDirectory: () => directory,
    durableJournal: false,
    createId: () => `id-${++identity}`
  });
  return { kernel, directory, createId: () => `replanner-${++identity}` };
}

describe("Verification Loop 3.0", () => {
  it("classifies implementation, test, environment, conflict, evidence and requirement failures", () => {
    assert.equal(classifyPlatformFailure({ code: "worker-failed" }).type, FAILURE_TYPES.IMPLEMENTATION);
    assert.equal(classifyPlatformFailure({ error: "AssertionError: tests failed" }).type, FAILURE_TYPES.TEST);
    assert.equal(classifyPlatformFailure({ error: "spawn git ENOENT" }).type, FAILURE_TYPES.ENVIRONMENT);
    assert.equal(classifyPlatformFailure({ code: "integration-conflict" }).type, FAILURE_TYPES.CONFLICT);
    assert.equal(classifyPlatformFailure({ code: "platform-criterion-evidence-required" }).type, FAILURE_TYPES.EVIDENCE);
    const ambiguous = classifyPlatformFailure({ code: "needs-user-input" });
    assert.equal(ambiguous.type, FAILURE_TYPES.REQUIREMENTS);
    assert.equal(ambiguous.requiresUserInput, true);
  });

  it("records an independent Replanner AgentRun and a bounded Task Graph revision", () => {
    const value = harness();
    const run = value.kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      objective: "repair a failing build",
      mode: "coding"
    }).run;
    value.kernel.addTask(run.id, { taskId: "original", title: "Original implementation" });
    const begun = value.kernel.beginAgentRun({
      platformRunId: run.id,
      agentRunId: "implementer-agent",
      taskId: "original",
      role: "implementer"
    });
    assert.equal(begun.ok, true);
    value.kernel.finishAgentRun(run.id, "implementer-agent", {
      status: "failed",
      error: "npm run build failed",
      taskStatus: "failed"
    });

    const replanner = new IndependentReplanner({
      platformKernel: value.kernel,
      createId: value.createId
    });
    const result = replanner.replan(run.id, {
      code: "build-failed",
      error: "npm run build failed"
    });
    assert.equal(result.ok, true);
    assert.equal(result.classification.type, "test");
    const latest = value.kernel.getRun(run.id);
    const replanAgent = latest.agentRuns[result.replan.agentRunId];
    assert.equal(replanAgent.role, "replanner");
    assert.notEqual(replanAgent.id, "implementer-agent");
    assert.equal(replanAgent.status, "completed");
    assert.equal(result.repairTask.status, "ready");
    assert.equal(latest.replans.length, 1);
    assert.equal(latest.failures.length, 1);
    assert.equal(replanner.replan(run.id, { code: "build-failed", error: "npm run build failed" }).reused, true);
  });

  it("routes a failed background Job through classification and the independent Replanner", async () => {
    const value = harness();
    const run = value.kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      objective: "background verification",
      mode: "coding"
    }).run;
    const replanner = new IndependentReplanner({
      platformKernel: value.kernel,
      createId: value.createId
    });
    const scheduler = new PlatformJobScheduler({
      platformKernel: value.kernel,
      onFailure: ({ job, error }) => replanner.replan(
        job.platformRunId,
        classifyPlatformFailure({ code: error.code, error: error.message })
      )
    });
    scheduler.register("verify", async () => ({
      ok: false,
      code: "test-command-failed",
      error: "AssertionError: expected true"
    }));
    const job = scheduler.enqueue(run.id, {
      type: "verify",
      title: "Run verification",
      retryPolicy: { enabled: false }
    }).job;
    const result = await scheduler.wait(job.id, { timeoutMs: 2000 });
    assert.equal(result.ok, false);
    assert.equal(result.replan.ok, true);
    assert.equal(result.replan.classification.type, "test");
    assert.equal(value.kernel.getRun(run.id).replans.length, 1);
  });

  it("binds every Done when criterion to a concrete Artifact and Tool receipt", () => {
    const { kernel } = harness();
    const execution = kernel.prepareExecution({
      conversationId: "conversation",
      goal: {
        id: "goal",
        revision: 3,
        objective: "update the file",
        criteria: [{
          id: "changed",
          text: "The requested file is updated",
          verificationKind: "change"
        }]
      },
      agentRunId: "main-agent",
      taskId: "main-task",
      mode: "coding"
    });
    const verification = {
      version: 3,
      status: "verified",
      verified: true,
      checks: [{
        id: "criterion:changed",
        criterionId: "changed",
        verificationKind: "change",
        passed: true,
        evidence: ["receipt-1"]
      }]
    };
    const completion = kernel.authorizeCompletion({
      platformRunId: execution.platformRunId,
      agentRunId: "main-agent",
      verification,
      records: [{
        id: "receipt-1",
        name: "write_text_file",
        status: "completed",
        input: { path: "README.md" },
        result: { ok: true, afterSha256: "abc" }
      }]
    });
    assert.equal(completion.ok, true);
    const run = kernel.getRun(execution.platformRunId);
    const artifact = run.artifacts.find((item) => item.receiptIds.includes("receipt-1"));
    assert.equal(artifact.kind, "tool-receipt");
    const evidence = run.evidence.find((item) => item.criterionId === "changed");
    assert.equal(evidence.status, "valid");
    assert.equal(evidence.artifactId, artifact.id);
    assert.deepEqual(evidence.receiptIds, ["receipt-1"]);
    assert.match(completion.permit.payload.artifactManifestHash, /^[a-f0-9]{64}$/u);
    assert.match(completion.permit.payload.taskGraphHash, /^[a-f0-9]{64}$/u);
    assert.match(completion.permit.payload.reviewHash, /^[a-f0-9]{64}$/u);
  });

  it("rejects completion when a criterion has no source Artifact", () => {
    const { kernel } = harness();
    const execution = kernel.prepareExecution({
      conversationId: "conversation",
      goal: {
        id: "goal",
        revision: 1,
        objective: "run tests",
        criteria: [{ id: "tests", text: "Tests pass", verificationKind: "test" }]
      },
      agentRunId: "main-agent",
      taskId: "main-task",
      mode: "coding"
    });
    const completion = kernel.authorizeCompletion({
      platformRunId: execution.platformRunId,
      agentRunId: "main-agent",
      verification: {
        status: "verified",
        verified: true,
        checks: [{ criterionId: "tests", passed: true, evidence: ["missing-receipt"] }]
      },
      records: []
    });
    assert.equal(completion.ok, false);
    assert.equal(completion.code, "platform-criterion-evidence-required");
    assert.deepEqual(completion.criterionIds, ["tests"]);
    assert.equal(kernel.getRun(execution.platformRunId).tasks["main-task"].status, "running");
  });

  it("invalidates old Evidence and the final signature when code changes", () => {
    const { kernel } = harness();
    const execution = kernel.prepareExecution({
      conversationId: "conversation",
      goal: { id: "goal", revision: 1, objective: "finish" },
      agentRunId: "main-agent",
      taskId: "main-task",
      mode: "coding"
    });
    const completion = kernel.authorizeCompletion({
      platformRunId: execution.platformRunId,
      agentRunId: "main-agent",
      verification: { version: 3, status: "verified", verified: true, checks: [] }
    });
    assert.equal(completion.ok, true);
    assert.equal(kernel.verifyCompletionPermit(completion.permit, {
      goalId: "goal",
      goalRevision: 1,
      platformRunId: execution.platformRunId
    }).ok, true);

    kernel.recordArtifact(execution.platformRunId, {
      kind: "git-commit",
      commit: "changed-after-signing",
      changed: true,
      digest: "changed"
    });
    const latest = kernel.getRun(execution.platformRunId);
    assert.equal(latest.completionPermit, null);
    assert.equal(kernel.verifyCompletionPermit(completion.permit, {
      goalId: "goal",
      goalRevision: 1,
      platformRunId: execution.platformRunId
    }).code, "completion-signature-superseded");
  });

  it("replays Failure, Replan and Evidence records from the Journal", () => {
    const value = harness();
    const run = value.kernel.ensureRun({
      conversationId: "conversation",
      goalId: "goal",
      goalRevision: 2,
      objective: "recover verification state",
      criteria: [{ id: "done", text: "Done", verificationKind: "manual" }],
      mode: "coding"
    }).run;
    value.kernel.addTask(run.id, { taskId: "task", title: "Task" });
    const artifact = value.kernel.recordArtifact(run.id, {
      taskId: "task",
      kind: "user-confirmation",
      receiptIds: ["user-confirmed"],
      digest: "confirmation",
      source: "user"
    }).artifact;
    assert.equal(value.kernel.bindEvidence(run.id, {
      criterionId: "done",
      artifactId: artifact.id
    }).ok, true);
    const failure = value.kernel.recordFailure(run.id, classifyPlatformFailure({
      code: "platform-criterion-evidence-required"
    })).failure;
    value.kernel.recordReplan(run.id, {
      failureId: failure.id,
      agentRunId: "replanner",
      classification: "evidence",
      action: "produce-missing-evidence",
      addedTaskIds: ["task"],
      summary: "replanned"
    });
    fs.writeFileSync(path.join(value.directory, "platform-snapshot.json"), "{broken", "utf8");

    const recovered = new PlatformKernel({
      getStorageDirectory: () => value.directory,
      durableJournal: false
    }).getRun(run.id);
    assert.equal(recovered.failures.length, 1);
    assert.equal(recovered.replans.length, 1);
    assert.equal(recovered.evidence.length, 1);
    assert.equal(recovered.evidence[0].status, "invalid");
  });
});
