import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { PlatformKernel } from "../../electron/platform/PlatformKernel.js";
import {
  fingerprintTaskGraph,
  normalizeTaskDefinition,
  validateTaskGraph
} from "../../electron/platform/TaskGraphContract.js";

function directory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xixi-task-graph-"));
}

function runHarness() {
  const kernel = new PlatformKernel({ getStorageDirectory: directory });
  const run = kernel.ensureRun({
    conversationId: "conversation",
    goalId: "goal",
    objective: "atomic task graph",
    workspaceId: "workspace",
    mode: "coding"
  }).run;
  return { kernel, run };
}

describe("Task Graph Contract", () => {
  it("accepts forward references atomically and preserves the contract", () => {
    const { kernel, run } = runHarness();
    const result = kernel.addTaskGraph(run.id, [
      {
        id: "verify",
        title: "Verify",
        role: "tester",
        dependencies: ["implement"],
        acceptanceCriteria: [{ id: "tests", text: "Tests pass" }],
        workspaceScope: { path: "src", writable: true },
        resourceLocks: [{ key: "package-lock", mode: "shared" }],
        priority: 80
      },
      {
        id: "implement",
        title: "Implement",
        role: "implementer"
      }
    ]);

    assert.equal(result.ok, true);
    const latest = kernel.getRun(run.id);
    assert.equal(latest.taskGraphRevision, 1);
    assert.equal(latest.tasks.implement.status, "ready");
    assert.equal(latest.tasks.verify.status, "pending");
    assert.equal(latest.tasks.verify.workspaceScope.writable, false);
    assert.deepEqual(latest.tasks.verify.acceptanceCriteria, [{
      id: "tests",
      text: "Tests pass",
      verificationKind: "evaluator"
    }]);
    assert.equal(latest.taskGraphFingerprint, fingerprintTaskGraph(latest.tasks));
  });

  it("rejects a cyclic batch without partially mutating the run", () => {
    const { kernel, run } = runHarness();
    const before = kernel.getRun(run.id);
    const result = kernel.addTaskGraph(run.id, [
      { id: "a", title: "A", dependencies: ["b"] },
      { id: "b", title: "B", dependencies: ["a"] }
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.code, "task-graph-cycle");
    const after = kernel.getRun(run.id);
    assert.deepEqual(after.tasks, before.tasks);
    assert.equal(after.taskGraphRevision, before.taskGraphRevision);
    assert.equal(after.taskGraphFingerprint, before.taskGraphFingerprint);
  });

  it("normalizes role capabilities, scope and duplicate criterion ids", () => {
    const normalized = normalizeTaskDefinition({
      id: "review",
      role: "reviewer",
      workspaceScope: { path: "src", writable: true },
      acceptanceCriteria: [
        { id: "criterion", text: "No regression" },
        { id: "criterion", text: "Evidence attached" }
      ]
    });
    assert.equal(normalized.workspaceScope.writable, false);
    assert.equal(normalized.requiredCapabilities.includes("workspace.file.modify"), false);
    assert.deepEqual(
      normalized.acceptanceCriteria.map((item) => item.id),
      ["criterion", "criterion-2"]
    );

    const checked = validateTaskGraph({}, [normalized]);
    assert.equal(checked.ok, true);
  });
});
