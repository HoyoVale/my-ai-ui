import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ExecutionThreadRouter,
  ROUTING_ACTIONS,
  ROUTING_SOURCES,
  SteeringQueue,
  THREAD_COMMANDS,
  ThreadRoutingDecisionStore,
  classifyThreadCommand,
  normalizeThreadCommand
} from "../../electron/execution-model/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function conversation(overrides = {}) {
  return {
    id: "conversation-1",
    workspaceId: "workspace-1",
    executionThread: {
      id: "thread-1",
      taskId: "task-1",
      status: "waiting",
      workspaceId: "workspace-1",
      lastRunId: "run-1",
      lastAssistantMessageId: "assistant-1"
    },
    ...overrides
  };
}

function router() {
  let nextId = 0;
  return new ExecutionThreadRouter({
    createId: () => `decision-${++nextId}`,
    now: () => 100
  });
}

describe("ThreadCommand", () => {
  it("normalizes structured commands and classifies explicit task operations", () => {
    assert.equal(normalizeThreadCommand(" RESUME "), THREAD_COMMANDS.RESUME);
    assert.equal(normalizeThreadCommand("unknown"), "");
    assert.equal(classifyThreadCommand({ message: "新任务：解释 Docker" }).command, THREAD_COMMANDS.START);
    assert.equal(classifyThreadCommand({ message: "请继续完成" }).command, THREAD_COMMANDS.RESUME);
    assert.equal(classifyThreadCommand({ message: "从这里分支" }).command, THREAD_COMMANDS.FORK);
    assert.equal(classifyThreadCommand({ message: "重新生成" }).command, THREAD_COMMANDS.REGENERATE);
  });

  it("routes input during an active run to steering before semantic parsing", () => {
    const result = classifyThreadCommand({
      message: "新任务：先检查另一个文件",
      activeRun: true
    });
    assert.equal(result.command, THREAD_COMMANDS.STEER);
    assert.deepEqual(result.evidence, ["active-run"]);
  });
});

describe("ExecutionThreadRouter shadow decisions", () => {
  it("resumes a reusable thread without creating a new thread", () => {
    const decision = router().route({
      conversation: conversation(),
      message: "请继续",
      legacyAction: ROUTING_ACTIONS.RESUME
    });
    assert.equal(decision.action, ROUTING_ACTIONS.RESUME);
    assert.equal(decision.targetThreadId, "thread-1");
    assert.equal(decision.sourceRunId, "run-1");
    assert.equal(decision.shadow.mismatch, false);
  });

  it("starts a new thread for an explicit new task", () => {
    const decision = router().route({
      conversation: conversation(),
      message: "新任务：解释 Docker",
      legacyAction: ROUTING_ACTIONS.START
    });
    assert.equal(decision.action, ROUTING_ACTIONS.START);
    assert.equal(decision.source, ROUTING_SOURCES.EXPLICIT_COMMAND);
    assert.equal(decision.targetThreadId, "");
    assert.equal(decision.shadow.mismatch, false);
  });

  it("detects ordinary feedback that the legacy route would treat as a new task", () => {
    const decision = router().route({
      conversation: conversation(),
      message: "还是不对，这是新的测试日志",
      legacyAction: ROUTING_ACTIONS.START
    });
    assert.equal(decision.action, ROUTING_ACTIONS.RESUME);
    assert.equal(decision.source, ROUTING_SOURCES.SEMANTIC_FALLBACK);
    assert.equal(decision.shadow.mismatch, true);
    assert.deepEqual(decision.evidence, [
      "message-intent:feedback",
      "thread-state:waiting"
    ]);
  });

  it("proposes steer while the legacy runtime still rejects concurrent input", () => {
    const decision = router().route({
      conversation: conversation(),
      activeRun: {
        runId: "run-active",
        executionThreadId: "thread-1"
      },
      message: "先不要修改 CSS",
      legacyAction: ROUTING_ACTIONS.REJECT
    });
    assert.equal(decision.command, THREAD_COMMANDS.STEER);
    assert.equal(decision.action, ROUTING_ACTIONS.STEER);
    assert.equal(decision.activeRunId, "run-active");
    assert.equal(decision.targetThreadId, "thread-1");
    assert.equal(decision.shadow.mismatch, true);
  });

  it("does not open a parallel thread from an explicit command while a run is active", () => {
    const decision = router().route({
      conversation: conversation(),
      activeRun: {
        runId: "run-active",
        executionThreadId: "thread-1"
      },
      requestedCommand: THREAD_COMMANDS.START,
      legacyAction: ROUTING_ACTIONS.REJECT
    });
    assert.equal(decision.action, ROUTING_ACTIONS.REJECT);
    assert.equal(decision.reason, "active-run-command-blocked");
    assert.equal(decision.shadow.mismatch, false);
  });

  it("never silently resumes a thread after the conversation workspace changes", () => {
    const changed = conversation({ workspaceId: "workspace-2" });
    const automatic = router().route({
      conversation: changed,
      message: "检查当前项目",
      legacyAction: ROUTING_ACTIONS.RESUME
    });
    assert.equal(automatic.action, ROUTING_ACTIONS.START);
    assert.equal(automatic.reason, "workspace-changed-start-new-thread");
    assert.equal(automatic.shadow.mismatch, true);

    const explicit = router().route({
      conversation: changed,
      requestedCommand: THREAD_COMMANDS.RESUME,
      legacyAction: ROUTING_ACTIONS.RESUME
    });
    assert.equal(explicit.action, ROUTING_ACTIONS.REJECT);
    assert.equal(explicit.reason, "resume-workspace-mismatch");
  });

  it("models fork and regeneration lineage without applying either operation", () => {
    const fork = router().route({
      operation: THREAD_COMMANDS.FORK,
      conversation: conversation(),
      sourceThreadId: "thread-1",
      sourceRunId: "run-1",
      targetThreadId: "thread-2",
      legacyAction: ROUTING_ACTIONS.START
    });
    assert.equal(fork.action, ROUTING_ACTIONS.FORK);
    assert.equal(fork.shadow.mismatch, true);

    const regeneration = router().route({
      operation: THREAD_COMMANDS.REGENERATE,
      conversation: conversation(),
      sourceRunId: "run-1",
      targetThreadId: "thread-1",
      targetRunId: "run-2",
      legacyAction: ROUTING_ACTIONS.REGENERATE
    });
    assert.equal(regeneration.action, ROUTING_ACTIONS.REGENERATE);
    assert.equal(regeneration.sourceRunId, "run-1");
    assert.equal(regeneration.targetRunId, "run-2");
    assert.equal(regeneration.shadow.mismatch, false);
  });

  it("rejects regeneration while another run is active", () => {
    const decision = router().route({
      operation: THREAD_COMMANDS.REGENERATE,
      conversation: conversation(),
      activeRun: { runId: "run-active", executionThreadId: "thread-1" },
      sourceRunId: "run-1",
      targetThreadId: "thread-1",
      legacyAction: ROUTING_ACTIONS.REJECT
    });
    assert.equal(decision.action, ROUTING_ACTIONS.REJECT);
    assert.equal(decision.reason, "regeneration-blocked-by-active-run");
    assert.equal(decision.shadow.mismatch, false);
  });
});

describe("ThreadRoutingDecisionStore", () => {
  it("keeps bounded sanitized decisions and reports mismatch metrics", () => {
    const store = new ThreadRoutingDecisionStore({ maxDecisions: 20 });
    const create = router();
    for (let index = 0; index < 25; index += 1) {
      store.record(create.route({
        conversation: conversation(),
        message: index % 2 ? "还是不对" : "继续",
        legacyAction: index % 2 ? ROUTING_ACTIONS.START : ROUTING_ACTIONS.RESUME
      }));
    }
    const snapshot = store.snapshot({ conversationId: "conversation-1", limit: 50 });
    assert.equal(snapshot.total, 20);
    assert.equal(snapshot.mismatchCount, 10);
    assert.equal(snapshot.byAction.resume, 20);
    assert.doesNotMatch(JSON.stringify(snapshot), /还是不对|继续/u);
  });

  it("binds the accepted message, thread and run ids without changing the shadow decision", () => {
    const store = new ThreadRoutingDecisionStore();
    const decision = store.record(router().route({
      conversation: conversation(),
      message: "新任务：检查布局",
      legacyAction: ROUTING_ACTIONS.START
    }));
    const bound = store.update(decision.id, {
      messageId: "user-2",
      targetThreadId: "thread-2",
      targetRunId: "run-2"
    });
    assert.equal(bound.messageId, "user-2");
    assert.equal(bound.targetThreadId, "thread-2");
    assert.equal(bound.targetRunId, "run-2");
    assert.equal(bound.state, "proposed");
  });
});

describe("SteeringQueue", () => {
  it("queues input for one active run and drains only the matching run", () => {
    let id = 0;
    const queue = new SteeringQueue({
      createId: () => `steer-${++id}`,
      now: () => 20
    });
    queue.enqueue({ threadId: "thread-1", runId: "run-1", content: "Do not edit CSS" });
    queue.enqueue({ threadId: "thread-1", runId: "run-2", content: "Run tests first" });
    assert.equal(queue.peek({ runId: "run-1" }).length, 1);
    assert.deepEqual(
      queue.drain({ runId: "run-1" }).map((item) => item.content),
      ["Do not edit CSS"]
    );
    assert.equal(queue.peek({ runId: "run-1" }).length, 0);
    assert.equal(queue.peek({ runId: "run-2" }).length, 1);
  });

  it("does not accept steering without explicit thread, run and content", () => {
    const queue = new SteeringQueue();
    assert.equal(queue.enqueue({ runId: "run-1", content: "x" }), null);
    assert.equal(queue.enqueue({ threadId: "thread-1", content: "x" }), null);
    assert.equal(queue.enqueue({ threadId: "thread-1", runId: "run-1" }), null);
  });
});

test("phase C is integrated in shadow mode without changing production routing", () => {
  const preparation = read("electron/agent/preparation/AgentRunPreparation.js");
  const runtime = read("electron/agent/AgentRuntime.js");
  const ipc = read("electron/ipc/handlers/agentIpc.js");
  const schema = read("electron/conversation/conversationSchema.js");
  assert.match(preparation, /executionThreadRouter\.route\(/u);
  assert.match(preparation, /legacyAction:/u);
  assert.match(preparation, /shadowMode:\s*true/u);
  assert.match(preparation, /threadRoutingDecisionStore\.record/u);
  assert.match(runtime, /threadRoutingDecisionStore\.snapshot/u);
  assert.match(ipc, /threadCommand/u);
  assert.doesNotMatch(preparation, /steeringQueue\.enqueue/u);
  assert.match(schema, /const STORE_VERSION = 22;/u);
});
