import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createGoalVerificationInstruction,
  GoalCompletionVerifier
} from "../../electron/agent/GoalCompletionVerifier.js";

const completedPlan = [
  { id: "change", title: "Implement fix", status: "completed" },
  { id: "verify", title: "Verify fix", status: "completed" }
];

function writeRecord(id = "write-1") {
  return {
    id,
    name: "apply_patch",
    status: "completed",
    result: { summary: "Patch applied" }
  };
}

function commandRecord(args, id = "command-1") {
  return {
    id,
    name: "run_workspace_command",
    status: "completed",
    input: { command: "npm", args },
    output: {
      ok: true,
      data: { command: "npm", args, exitCode: 0 }
    }
  };
}

describe("GoalCompletionVerifier", () => {
  it("keeps ordinary chat answers lightweight", () => {
    const result = new GoalCompletionVerifier().verify({
      objective: "Explain what an API is",
      mode: "chat"
    });

    assert.equal(result.verified, true);
  });

  it("rejects a coding completion claim without change evidence", () => {
    const result = new GoalCompletionVerifier().verify({
      objective: "请修复输入框布局",
      mode: "coding",
      plan: completedPlan,
      availableToolNames: ["apply_patch", "run_workspace_command"]
    });

    assert.equal(result.status, "incomplete");
    assert.equal(
      result.checks.find((item) => item.id === "change_evidence")?.passed,
      false
    );
  });

  it("does not mistake a coding-mode how-to question for a write request", () => {
    const result = new GoalCompletionVerifier().verify({
      objective: "请告诉我如何修改 React 组件",
      mode: "coding"
    });

    assert.equal(result.verified, true);
    assert.equal(
      result.checks.some((item) => item.id === "change_evidence"),
      false
    );
  });

  it("requires command evidence when a coding goal explicitly asks to run tests", () => {
    const result = new GoalCompletionVerifier().verify({
      objective: "请运行这个项目的测试",
      mode: "coding",
      availableToolNames: ["run_workspace_command"]
    });

    assert.equal(result.verified, false);
    assert.equal(
      result.checks.find((item) => item.id === "requested_validation")?.passed,
      false
    );
  });

  it("requires a successful validation command after the last mutation", () => {
    const verifier = new GoalCompletionVerifier();
    const result = verifier.verify({
      objective: "Implement the fix",
      mode: "coding",
      plan: completedPlan,
      records: [
        commandRecord(["test"], "test-before"),
        writeRecord()
      ],
      availableToolNames: ["apply_patch", "run_workspace_command"]
    });

    assert.equal(result.status, "incomplete");
    assert.equal(
      result.checks.find((item) => item.id === "post_change_validation")?.passed,
      false
    );
  });

  it("accepts settled changes with post-change test and build evidence", () => {
    const result = new GoalCompletionVerifier().verify({
      objective: "修改实现，然后运行测试和构建",
      mode: "coding",
      plan: completedPlan,
      records: [
        writeRecord(),
        commandRecord(["test"], "test-after"),
        commandRecord(["run", "build"], "build-after")
      ],
      availableToolNames: ["apply_patch", "run_workspace_command"],
      runtimeRecovery: { unresolvedCount: 0 }
    });

    assert.equal(result.status, "verified");
    assert.deepEqual(
      result.evidence.validations.flatMap((item) => item.kinds),
      ["test", "build"]
    );
  });

  it("refuses completion while side effects remain unresolved", () => {
    const result = new GoalCompletionVerifier().verify({
      objective: "Explain the current state",
      mode: "chat",
      runtimeRecovery: { unresolvedCount: 1 }
    });

    assert.equal(result.verified, false);
    assert.equal(
      result.checks.find((item) => item.id === "runtime_effects_settled")?.passed,
      false
    );
  });

  it("creates a bounded correction instruction from failed checks", () => {
    const result = new GoalCompletionVerifier().verify({
      objective: "Fix the bug",
      mode: "coding",
      plan: completedPlan
    });
    const instruction = createGoalVerificationInstruction(result);

    assert.match(instruction, /did not accept/u);
    assert.match(instruction, /没有成功的工作区写入/u);
    assert.doesNotMatch(instruction, /thought|chain of thought/iu);
  });
});
