import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXECUTION_ITEM_KINDS,
  EXECUTION_ITEM_STATES,
  RUN_RELATIONS,
  RUN_STATES_V2,
  executionItemSequenceFingerprint,
  projectConversationRuns,
  projectRun,
  projectRunExecutionItems,
  sequenceExecutionItems,
  stableExecutionItemId,
  validateExecutionItemSequence,
  validateRunProjection
} from "../../electron/execution-model/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function runFixture({
  activityStatus = "completed",
  activityOutcome = "completed",
  resumable = false,
  second = false
} = {}) {
  const userMessage = {
    id: second ? "user-2" : "user-1",
    role: "user",
    content: second ? "请继续" : "修复测试",
    status: "complete",
    createdAt: second ? 200 : 10
  };
  const runId = second ? "run-2" : "run-1";
  const assistantMessage = {
    id: second ? "assistant-2" : "assistant-1",
    role: "assistant",
    content: second
      ? "测试已经通过。"
      : "开始检查。\n\n<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name=\"read_text_file\">\n<｜｜DSML｜｜parameter name=\"filePath\">src/a.js</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>\n\n已完成修复。",
    status: "complete",
    createdAt: second ? 290 : 90,
    executionThreadId: "thread-1",
    resumedFromMessageId: second ? "assistant-1" : "",
    planState: {
      rootPlanId: "root-plan-1",
      rootItems: [
        { id: "inspect", title: "检查", status: "completed" },
        { id: "verify", title: "验证", status: "completed" }
      ]
    },
    toolCalls: [
      {
        id: "command-1",
        name: "run_project_script",
        title: "运行测试",
        status: "completed",
        queuedAt: 40,
        endedAt: 60,
        input: { script: "test", secret: "not-projected" },
        output: "large raw output",
        commandPreview: {
          displayCommand: "npm run test",
          stdout: "760 tests passed"
        },
        result: {
          status: "success",
          summary: "tests passed",
          reference: { uri: "tool-result://run-1/command-1" }
        }
      }
    ],
    diffSummary: {
      version: 1,
      revision: 2,
      empty: false,
      files: [{ path: "src/a.js", status: "modified" }],
      totals: { files: 1, added: 3, removed: 1 }
    },
    activity: {
      version: 3,
      taskId: "task-1",
      runId,
      status: activityStatus,
      outcome: activityOutcome,
      resumable,
      startedAt: second ? 210 : 20,
      endedAt: second ? 285 : 85,
      durationMs: 65,
      stopReason: activityOutcome,
      checkpoint: {
        id: `checkpoint-${runId}`,
        runId,
        phase: "complete",
        publicStatus: activityOutcome,
        updatedAt: second ? 282 : 82,
        orchestration: {
          goal: {
            verification: {
              id: `verification-${runId}`,
              status: "verified",
              verified: true,
              checks: [
                { id: "tests", passed: true },
                { id: "build", passed: true }
              ]
            }
          }
        }
      },
      events: [
        {
          id: `batch-${runId}`,
          type: "batch",
          sequence: 0,
          status: "completed",
          title: "修复并验证",
          createdAt: second ? 212 : 22,
          updatedAt: second ? 280 : 80,
          batch: {
            id: `batch-${runId}`,
            objective: "修复并验证",
            status: "completed",
            startedAt: second ? 212 : 22,
            endedAt: second ? 280 : 80
          }
        },
        {
          id: `comment-${runId}`,
          type: "commentary",
          sequence: 1,
          status: "completed",
          content: "先检查失败原因。",
          batchId: `batch-${runId}`,
          createdAt: second ? 214 : 24,
          updatedAt: second ? 214 : 24
        },
        {
          id: `plan-${runId}`,
          type: "plan",
          sequence: 2,
          status: "completed",
          title: "任务计划 · 2 步",
          plan: [
            { id: "inspect", title: "检查", status: "completed" },
            { id: "verify", title: "验证", status: "completed" }
          ],
          createdAt: second ? 216 : 26,
          updatedAt: second ? 216 : 26
        },
        {
          id: `tool-event-${runId}`,
          type: "tool",
          sequence: 3,
          status: "completed",
          batchId: `batch-${runId}`,
          createdAt: second ? 220 : 40,
          updatedAt: second ? 260 : 60,
          tool: {
            id: "command-1",
            name: "run_project_script",
            title: "运行测试",
            status: "completed",
            queuedAt: second ? 220 : 40,
            endedAt: second ? 260 : 60,
            commandPreview: {
              displayCommand: "npm run test",
              stdout: "760 tests passed"
            },
            result: {
              status: "success",
              summary: "tests passed",
              reference: { uri: `tool-result://${runId}/command-1` }
            }
          }
        },
        {
          id: `write-event-${runId}`,
          type: "tool",
          sequence: 4,
          status: "completed",
          createdAt: second ? 262 : 62,
          updatedAt: second ? 270 : 70,
          tool: {
            id: "write-1",
            name: "replace_text_in_file",
            title: "修改文件",
            status: "completed",
            result: {
              status: "success",
              summary: "updated src/a.js",
              changePreview: {
                path: "src/a.js",
                diff: "-old\n+new"
              }
            }
          }
        },
        {
          id: `status-${runId}`,
          type: "status",
          sequence: 5,
          status: activityStatus,
          title: activityOutcome,
          createdAt: second ? 280 : 80,
          updatedAt: second ? 280 : 80
        }
      ]
    }
  };
  return { userMessage, assistantMessage };
}

describe("ExecutionItemSequence", () => {
  it("orders projection groups deterministically and removes duplicate sources", () => {
    const base = {
      threadId: "thread-1",
      runId: "run-1",
      scope: "run",
      status: "completed",
      visibility: "public",
      sourceType: "activity_event",
      createdAt: 10,
      completedAt: 10
    };
    const sources = [
      {
        ...base,
        id: "final",
        kind: "assistant_final",
        sourceId: "assistant-1",
        sequence: 99,
        summary: "done",
        projection: { group: 3, timestamp: 10, sourceSequence: 0 }
      },
      {
        ...base,
        id: "user",
        kind: "user_message",
        sourceType: "conversation_message",
        sourceId: "user-1",
        sequence: 88,
        summary: "request",
        projection: { group: 0, timestamp: 10, sourceSequence: 0 }
      },
      {
        ...base,
        id: "tool-poor",
        kind: "tool_call",
        sourceId: "tool-1",
        sequence: 2,
        summary: "tool",
        projection: {
          group: 1,
          timestamp: 20,
          sourceSequence: 1,
          dedupeKey: "tool:run-1:tool-1",
          priority: 10
        }
      },
      {
        ...base,
        id: "tool-rich",
        kind: "tool_call",
        sourceId: "tool-1",
        sequence: 1,
        summary: "tool with result",
        resultRef: "tool-result://tool-1",
        projection: {
          group: 1,
          timestamp: 20,
          sourceSequence: 1,
          dedupeKey: "tool:run-1:tool-1",
          priority: 100
        }
      }
    ];
    const forward = sequenceExecutionItems(sources);
    const reverse = sequenceExecutionItems([...sources].reverse());
    assert.deepEqual(forward, reverse);
    assert.deepEqual(forward.map((item) => item.kind), [
      "user_message",
      "tool_call",
      "assistant_final"
    ]);
    assert.equal(forward[1].id, "tool-rich");
    assert.deepEqual(validateExecutionItemSequence(forward), { ok: true, errors: [] });
  });

  it("creates stable ids and fingerprints across JSON reloads", () => {
    const identity = {
      threadId: "thread-1",
      runId: "run-1",
      kind: "command",
      sourceType: "activity_event",
      sourceId: "event-1"
    };
    assert.equal(stableExecutionItemId(identity), stableExecutionItemId(identity));
    const fixture = runFixture();
    const items = projectRunExecutionItems({
      threadId: "thread-1",
      runId: "run-1",
      ...fixture
    });
    const reloaded = JSON.parse(JSON.stringify(items));
    assert.equal(
      executionItemSequenceFingerprint(items),
      executionItemSequenceFingerprint(reloaded)
    );
  });
});

describe("ExecutionItemProjector", () => {
  it("projects one ordered timeline from messages, activity, tools, plan, diff and checkpoint", () => {
    const fixture = runFixture();
    const items = projectRunExecutionItems({
      threadId: "thread-1",
      runId: "run-1",
      ...fixture
    });
    assert.equal(items[0].kind, EXECUTION_ITEM_KINDS.USER_MESSAGE);
    assert.equal(items.at(-1).kind, EXECUTION_ITEM_KINDS.ASSISTANT_FINAL);
    assert.equal(items.filter((item) => item.kind === EXECUTION_ITEM_KINDS.COMMAND).length, 1);
    assert.equal(items.filter((item) => item.kind === EXECUTION_ITEM_KINDS.FILE_CHANGE).length, 1);
    assert.equal(items.filter((item) => item.kind === EXECUTION_ITEM_KINDS.DIFF).length, 1);
    assert.equal(items.filter((item) => item.kind === EXECUTION_ITEM_KINDS.CHECKPOINT).length, 1);
    assert.equal(items.filter((item) => item.kind === EXECUTION_ITEM_KINDS.VERIFICATION).length, 1);
    assert.doesNotMatch(items.at(-1).summary, /DSML|tool_calls|invoke/u);
  });

  it("keeps item payloads bounded and references detailed results instead of copying them", () => {
    const fixture = runFixture();
    const items = projectRunExecutionItems({
      threadId: "thread-1",
      runId: "run-1",
      ...fixture
    });
    const serialized = JSON.stringify(items);
    assert.doesNotMatch(serialized, /not-projected|large raw output|760 tests passed/u);
    const command = items.find((item) => item.kind === EXECUTION_ITEM_KINDS.COMMAND);
    assert.equal(command.summary, "npm run test");
    assert.equal(command.resultRef, "tool-result://run-1/command-1");
    assert.equal("input" in command, false);
    assert.equal("result" in command, false);
    assert.equal("output" in command, false);
  });

  it("links tool activity to its projected batch item", () => {
    const fixture = runFixture();
    const items = projectRunExecutionItems({
      threadId: "thread-1",
      runId: "run-1",
      ...fixture
    });
    const batch = items.find((item) => item.sourceId === "batch-run-1");
    const command = items.find((item) => item.kind === EXECUTION_ITEM_KINDS.COMMAND);
    assert.ok(batch);
    assert.equal(command.parentItemId, batch.id);
  });

  it("returns no projection without explicit thread and run ownership", () => {
    const fixture = runFixture();
    assert.deepEqual(projectRunExecutionItems({ runId: "run-1", ...fixture }), []);
    assert.deepEqual(projectRunExecutionItems({ threadId: "thread-1", ...fixture }), []);
  });
});

describe("RunProjection", () => {
  it("projects a completed run with identity, counts and stable item sequence", () => {
    const fixture = runFixture();
    const projection = projectRun({
      conversationId: "conversation-1",
      threadId: "thread-1",
      sequence: 1,
      ...fixture
    });
    assert.equal(projection.state, RUN_STATES_V2.COMPLETED);
    assert.equal(projection.relation, RUN_RELATIONS.INITIAL);
    assert.equal(projection.itemCounts.total, projection.items.length);
    assert.equal(projection.itemCounts.byKind.command, 1);
    assert.deepEqual(validateRunProjection(projection), { ok: true, errors: [] });
  });

  it("maps a resumable checkpoint boundary to a terminal continuable run", () => {
    const fixture = runFixture({
      activityStatus: "checkpoint_ready",
      activityOutcome: "continuable",
      resumable: true
    });
    const projection = projectRun({
      threadId: "thread-1",
      sequence: 1,
      ...fixture
    });
    assert.equal(projection.state, RUN_STATES_V2.CONTINUABLE);
    assert.equal(projection.resumable, true);
  });

  it("projects conversation runs in message order and records continuation lineage", () => {
    const first = runFixture();
    const second = runFixture({ second: true });
    const conversation = {
      id: "conversation-1",
      executionThread: { id: "thread-1" },
      messages: [
        first.userMessage,
        first.assistantMessage,
        second.userMessage,
        second.assistantMessage
      ]
    };
    const runs = projectConversationRuns({ conversation });
    assert.equal(runs.length, 2);
    assert.equal(runs[0].relation, RUN_RELATIONS.INITIAL);
    assert.equal(runs[1].relation, RUN_RELATIONS.RESUME);
    assert.equal(runs[1].previousRunId, "run-1");
    assert.equal(runs[1].userMessageId, "user-2");
  });

  it("does not synthesize a thread id for an unbound historical conversation", () => {
    const fixture = runFixture();
    const conversation = {
      id: "conversation-1",
      messages: [
        fixture.userMessage,
        { ...fixture.assistantMessage, executionThreadId: "" }
      ]
    };
    assert.deepEqual(projectConversationRuns({ conversation }), []);
    assert.equal(
      projectConversationRuns({ conversation, threadId: "legacy-thread" }).length,
      1
    );
  });
});

test("phase B remains a read-only projection layer", () => {
  const conversationSchema = read("electron/conversation/conversationSchema.js");
  const runtimeSources = [
    read("electron/agent/AgentRuntime.js"),
    read("electron/conversation/ConversationManager.js"),
    read("electron/platform/PlatformKernel.js")
  ].join("\n");
  assert.match(conversationSchema, /const STORE_VERSION = 22;/u);
  assert.doesNotMatch(runtimeSources, /ExecutionItemProjector|RunProjection/u);
  assert.doesNotMatch(
    read("electron/execution-model/ExecutionItemProjector.js"),
    /ConversationStore|ToolResultStore|RunDiffTracker/u
  );
});
