import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IntegrationCoordinator } from "../../electron/platform/IntegrationCoordinator.js";

describe("Integration eligibility", () => {
  it("accepts only artifacts bound to an approved Worker handoff", () => {
    const coordinator = new IntegrationCoordinator({
      platformKernel: {},
      worktreeRuntime: {},
      reviewerRuntime: {},
      getWorkspaceRoot: () => ""
    });
    const run = {
      artifacts: [{
        id: "artifact",
        kind: "git-commit",
        changed: true,
        taskId: "task",
        agentRunId: "worker",
        createdAt: 1
      }],
      agentRuns: {
        worker: {
          id: "worker",
          role: "implementer",
          status: "completed",
          handoff: { fingerprint: "handoff" }
        }
      },
      tasks: {
        task: {
          id: "task",
          createdAt: 1,
          integrationStatus: "blocked",
          evaluation: {
            approved: false,
            workerAgentRunId: "worker",
            handoffFingerprint: "handoff"
          }
        }
      }
    };

    assert.deepEqual(coordinator.candidates(run), []);
    run.tasks.task.integrationStatus = "eligible";
    run.tasks.task.evaluation.approved = true;
    assert.deepEqual(coordinator.candidates(run).map((item) => item.id), ["artifact"]);
    run.tasks.task.evaluation.handoffFingerprint = "other";
    assert.deepEqual(coordinator.candidates(run), []);
  });
});
