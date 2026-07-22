import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  beginExecutionThreadRun,
  createExecutionThread,
  finishExecutionThreadRun,
  resolveExecutionThreadContinuation
} from "../../electron/agent/ExecutionThread.js";

import {
  PublicTextStreamSanitizer,
  sanitizePublicAssistantText,
  containsProviderProtocol
} from "../../electron/agent/PublicTextSanitizer.js";

import {
  classifyToolFailureHistory
} from "../../electron/agent/ToolErrorClassifier.js";

import {
  resolveRunOutcome
} from "../../electron/agent/RunOutcomeResolver.js";

import {
  RUN_OUTCOMES
} from "../../electron/agent/RunStateMachine.js";

import {
  inferRunStopReason,
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";

function projectScriptRecord(id, status, exitCode) {
  return {
    id,
    name: "run_project_script",
    status,
    input: { script: "test", cwd: "." },
    result: status === "failed"
      ? {
          error: {
            code: "PROCESS_EXIT_NON_ZERO",
            category: "process_exit",
            message: `Exited ${exitCode}`,
            retryable: false
          }
        }
      : { status: "success" }
  };
}

describe("Execution Consistency phase 1", () => {
  it("reuses one ordinary execution thread when the user says continue", () => {
    const created = createExecutionThread({
      id: "thread-1",
      taskId: "task-1",
      objective: "Fix the scene test",
      mode: "coding",
      workspaceId: "workspace-1",
      runId: "run-1",
      planState: {
        rootPlanId: "thread-1:root",
        rootItems: [{ id: "fix", title: "Fix test", status: "completed" }]
      },
      now: 1
    });
    const completed = finishExecutionThreadRun(created, {
      outcome: "completed",
      stopReason: "completed",
      lastAssistantMessageId: "assistant-1",
      now: 2
    });
    const continuation = resolveExecutionThreadContinuation({
      conversation: { executionThread: completed },
      message: "请你继续"
    });

    assert.ok(continuation);
    assert.equal(continuation.checkpoint.executionThreadId, "thread-1");
    assert.equal(continuation.checkpoint.taskId, "task-1");
    assert.equal(continuation.checkpoint.goalId, "");
    assert.equal(continuation.checkpoint.planState.rootPlanId, "thread-1:root");

    const next = beginExecutionThreadRun(completed, { runId: "run-2", now: 3 });
    assert.equal(next.id, "thread-1");
    assert.equal(next.taskId, "task-1");
    assert.equal(next.continuationCount, 1);
  });

  it("lets a later successful verification supersede an earlier failure", () => {
    const history = classifyToolFailureHistory([
      projectScriptRecord("test-1", "failed", 1),
      projectScriptRecord("test-2", "completed", 0)
    ]);
    assert.equal(history.hasActive, false);
    assert.equal(history.resolved.length, 1);

    const result = resolveRunOutcome({
      stopReason: RUN_STOP_REASONS.TOOL_ERROR,
      records: [
        projectScriptRecord("test-1", "failed", 1),
        projectScriptRecord("test-2", "completed", 0)
      ],
      plan: [{ id: "fix", title: "Fix test", status: "completed" }],
      finalText: "57 tests passed."
    });
    assert.equal(result.stopReason, RUN_STOP_REASONS.COMPLETED);
    assert.equal(result.outcome, RUN_OUTCOMES.COMPLETED);
  });

  it("infers completion after a later successful retry resolves the tool error", () => {
    const stopReason = inferRunStopReason({
      records: [
        projectScriptRecord("test-1", "failed", 1),
        projectScriptRecord("test-2", "completed", 0)
      ],
      finishReason: "stop",
      plan: [{ id: "fix", title: "Fix test", status: "completed" }]
    });
    assert.equal(stopReason, RUN_STOP_REASONS.COMPLETED);
  });

  it("keeps an unresolved failure active", () => {
    const result = resolveRunOutcome({
      stopReason: RUN_STOP_REASONS.TOOL_ERROR,
      records: [projectScriptRecord("test-1", "failed", 1)],
      plan: [{ id: "fix", title: "Fix test", status: "completed" }],
      finalText: "Tests failed."
    });
    assert.equal(result.stopReason, RUN_STOP_REASONS.TOOL_ERROR);
    assert.notEqual(result.outcome, RUN_OUTCOMES.COMPLETED);
  });


  it("suppresses a provider protocol block split across stream chunks", () => {
    const sanitizer = new PublicTextStreamSanitizer({ tailLength: 32 });
    const chunks = [
      "已完成检查。\n<｜｜DSML｜｜tool_",
      "calls>\n<｜｜DSML｜｜invoke name=\"read_text_file\">",
      "{\"path\":\"src/a.js\"}",
      "<｜｜DSML｜｜/tool_calls>\n最终结果正常。"
    ];
    const output = chunks.map((chunk) => sanitizer.push(chunk)).join("") + sanitizer.flush();
    assert.equal(output, "已完成检查。\n最终结果正常。");
    assert.equal(containsProviderProtocol(output), false);
    assert.doesNotMatch(output, /src\/a\.js/u);
  });
  it("keeps nested DSML invoke blocks suppressed until the outer tool_calls end", () => {
    const sanitizer = new PublicTextStreamSanitizer({ tailLength: 32 });
    const chunks = [
      "准备完成。\n<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name=\"read_text_file\">",
      "<｜｜DSML｜｜parameter name=\"filePath\">src/a.js</｜｜DSML｜｜parameter>",
      "</｜｜DSML｜｜invoke>\n<｜｜DSML｜｜invoke name=\"read_text_file\">",
      "<｜｜DSML｜｜parameter name=\"filePath\">src/b.js</｜｜DSML｜｜parameter>",
      "</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>\n最终结果。"
    ];
    const output = chunks.map((chunk) => sanitizer.push(chunk)).join("") + sanitizer.flush();
    assert.equal(output, "准备完成。\n最终结果。");
    assert.equal(containsProviderProtocol(output), false);
    assert.doesNotMatch(output, /src\/[ab]\.js/u);
  });

  it("removes provider tool protocol from public text", () => {
    const raw = [
      "已完成分析。",
      "<｜｜DSML｜｜tool_calls>",
      "<｜｜DSML｜｜invoke name=\"read_text_file\">",
      "{\"path\":\"src/a.js\"}",
      "<｜｜DSML｜｜/tool_calls>"
    ].join("\n");
    const clean = sanitizePublicAssistantText(raw);
    assert.equal(clean, "已完成分析。");
    assert.equal(containsProviderProtocol(clean), false);
  });
});
