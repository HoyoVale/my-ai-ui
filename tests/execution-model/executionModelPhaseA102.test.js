import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXECUTION_ITEM_KINDS,
  EXECUTION_ITEM_SCOPES,
  EXECUTION_ITEM_STATES,
  EXECUTION_MODEL_INVARIANTS,
  EXECUTION_MODEL_VERSION,
  EXECUTION_STATE_AUTHORITIES,
  ROUTING_ACTIONS,
  ROUTING_DECISION_STATES,
  ROUTING_SOURCES,
  RUN_RELATIONS,
  RUN_STATES_V2,
  THREAD_COMMANDS,
  THREAD_STATES,
  authorityForExecutionState,
  canTransitionExecutionItem,
  canTransitionRunState,
  canTransitionThreadState,
  createExecutionItem,
  createRunIdentity,
  createThreadLifecycle,
  createThreadRoutingDecision,
  sanitizeExecutionItem,
  transitionExecutionItem,
  transitionRunIdentity,
  transitionThreadState,
  validateExecutionOwnership,
  validateRunLineage,
  validateThreadRoutingDecision
} from "../../electron/execution-model/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function createRun(overrides = {}) {
  return createRunIdentity({
    id: "run-1",
    threadId: "thread-1",
    sequence: 1,
    state: RUN_STATES_V2.QUEUED,
    now: 10,
    ...overrides
  });
}

function createItem(overrides = {}) {
  return createExecutionItem({
    id: "item-1",
    threadId: "thread-1",
    runId: "run-1",
    sequence: 1,
    kind: EXECUTION_ITEM_KINDS.TOOL_CALL,
    now: 10,
    ...overrides
  });
}

describe("Execution Model 2.0 phase A contract", () => {
  it("declares the model version, authorities and architecture invariants", () => {
    assert.equal(EXECUTION_MODEL_VERSION, 2);
    assert.equal(authorityForExecutionState("plan"), "PlanAuthority");
    assert.equal(
      EXECUTION_STATE_AUTHORITIES.itemProjection,
      "ExecutionItemProjector"
    );
    assert.ok(EXECUTION_MODEL_INVARIANTS.includes("terminal_run_is_immutable"));
    assert.ok(EXECUTION_MODEL_INVARIANTS.includes("routing_is_auditable"));
  });

  it("keeps one thread authoritative for a run and its projected item", () => {
    const run = createRun();
    const item = createItem();
    assert.deepEqual(
      validateExecutionOwnership({ threadId: "thread-1", run, item }),
      { ok: true, errors: [] }
    );
    assert.deepEqual(
      validateExecutionOwnership({ threadId: "thread-2", run, item }).errors,
      ["run-thread-mismatch", "item-thread-mismatch"]
    );
  });
});

describe("ThreadStateMachine", () => {
  it("accepts the planned durable thread lifecycle", () => {
    assert.equal(canTransitionThreadState(THREAD_STATES.CREATED, THREAD_STATES.ACTIVE), true);
    assert.equal(canTransitionThreadState(THREAD_STATES.ACTIVE, THREAD_STATES.RUNNING), true);
    assert.equal(canTransitionThreadState(THREAD_STATES.RUNNING, THREAD_STATES.CONTINUABLE), true);
    assert.equal(canTransitionThreadState(THREAD_STATES.CONTINUABLE, THREAD_STATES.RUNNING), true);
    assert.equal(canTransitionThreadState(THREAD_STATES.COMPLETED, THREAD_STATES.ACTIVE), true);
    assert.equal(canTransitionThreadState(THREAD_STATES.ARCHIVED, THREAD_STATES.ACTIVE), false);
  });

  it("uses optimistic revisions and preserves a transition audit record", () => {
    const created = createThreadLifecycle({
      threadId: "thread-1",
      workspaceId: "workspace-1",
      now: 10
    });
    const activated = transitionThreadState(created, THREAD_STATES.ACTIVE, {
      action: "thread/start",
      reason: "explicit user command",
      expectedRevision: 0,
      now: 20
    });
    assert.equal(activated.ok, true);
    assert.equal(activated.lifecycle.revision, 1);
    assert.deepEqual(activated.lifecycle.lastTransition, {
      from: "created",
      to: "active",
      action: "thread/start",
      reason: "explicit user command",
      at: 20
    });

    const conflict = transitionThreadState(
      activated.lifecycle,
      THREAD_STATES.RUNNING,
      { expectedRevision: 0, now: 30 }
    );
    assert.equal(conflict.code, "thread-revision-conflict");
  });

  it("does not reopen an archived thread", () => {
    const archived = createThreadLifecycle({
      threadId: "thread-1",
      status: THREAD_STATES.ARCHIVED,
      now: 10
    });
    const result = transitionThreadState(archived, THREAD_STATES.ACTIVE, { now: 20 });
    assert.equal(result.code, "thread-transition-invalid");
  });
});

describe("RunIdentityContract", () => {
  it("models one accepted input as one run inside a stable thread", () => {
    const initial = createRun({ userMessageId: "message-1" });
    assert.equal(initial.threadId, "thread-1");
    assert.equal(initial.relation, RUN_RELATIONS.INITIAL);
    assert.equal(initial.sequence, 1);
  });

  it("allows execution transitions but never reopens a terminal run", () => {
    assert.equal(canTransitionRunState(RUN_STATES_V2.QUEUED, RUN_STATES_V2.PREPARING), true);
    assert.equal(canTransitionRunState(RUN_STATES_V2.RUNNING, RUN_STATES_V2.FINALIZING), true);
    const queued = createRun();
    const preparing = transitionRunIdentity(queued, RUN_STATES_V2.PREPARING, { now: 20 });
    const running = transitionRunIdentity(preparing.run, RUN_STATES_V2.RUNNING, { now: 30 });
    const finalizing = transitionRunIdentity(running.run, RUN_STATES_V2.FINALIZING, { now: 40 });
    const completed = transitionRunIdentity(finalizing.run, RUN_STATES_V2.COMPLETED, { now: 50 });
    assert.equal(completed.run.terminalAt, 50);
    assert.equal(
      transitionRunIdentity(completed.run, RUN_STATES_V2.RUNNING).code,
      "terminal-run-immutable"
    );
  });

  it("requires explicit retry, regeneration and fork lineage", () => {
    const run1 = createRun();
    const retry = createRun({
      id: "run-2",
      sequence: 2,
      relation: RUN_RELATIONS.RETRY,
      previousRunId: "run-1",
      retryOfRunId: "run-1"
    });
    assert.deepEqual(validateRunLineage(retry, [run1]), { ok: true, errors: [] });

    const invalidRegeneration = createRun({
      id: "run-3",
      sequence: 3,
      relation: RUN_RELATIONS.REGENERATE
    });
    assert.deepEqual(
      validateRunLineage(invalidRegeneration, [run1, retry]).errors,
      ["regeneration-parent-required"]
    );

    const fork = createRun({
      id: "fork-run-1",
      threadId: "thread-2",
      sequence: 1,
      relation: RUN_RELATIONS.FORK,
      forkedFromThreadId: "thread-1",
      forkedFromRunId: "run-1"
    });
    assert.deepEqual(validateRunLineage(fork, [run1]), { ok: true, errors: [] });
  });

  it("rejects ambiguous retry and regeneration parents", () => {
    assert.equal(createRun({
      id: "run-2",
      retryOfRunId: "run-1",
      regeneratedFromRunId: "run-1"
    }), null);
  });
});

describe("ExecutionItemSchema", () => {
  it("creates a bounded index item without copying raw tool payloads", () => {
    const item = sanitizeExecutionItem({
      ...createItem({
        summary: "x".repeat(1500),
        resultRef: "tool-result://thread-1/run-1/item-1"
      }),
      input: { secret: "do-not-copy" },
      result: { output: "large-result" },
      output: "raw-output"
    });
    assert.equal(item.summary.length, 1000);
    assert.equal(item.resultRef, "tool-result://thread-1/run-1/item-1");
    assert.equal("input" in item, false);
    assert.equal("result" in item, false);
    assert.equal("output" in item, false);
  });

  it("requires either run scope or explicit thread scope", () => {
    assert.ok(createItem());
    assert.ok(createItem({
      id: "checkpoint-1",
      runId: "",
      scope: EXECUTION_ITEM_SCOPES.THREAD,
      kind: EXECUTION_ITEM_KINDS.CHECKPOINT
    }));
    assert.equal(createItem({ runId: "" }), null);
    assert.equal(createItem({
      runId: "run-1",
      scope: EXECUTION_ITEM_SCOPES.THREAD
    }), null);
  });

  it("preserves failed history while marking it superseded by later evidence", () => {
    assert.equal(
      canTransitionExecutionItem(
        EXECUTION_ITEM_STATES.FAILED,
        EXECUTION_ITEM_STATES.SUPERSEDED
      ),
      true
    );
    const failed = createItem({ status: EXECUTION_ITEM_STATES.FAILED });
    const superseded = transitionExecutionItem(
      failed,
      EXECUTION_ITEM_STATES.SUPERSEDED,
      { supersededBy: "item-2", now: 30 }
    );
    assert.equal(superseded.ok, true);
    assert.equal(superseded.item.resolved, true);
    assert.equal(superseded.item.supersededBy, "item-2");
  });
});

describe("ThreadRoutingDecision", () => {
  it("records an explicit start decision without storing raw user content", () => {
    const decision = createThreadRoutingDecision({
      id: "decision-1",
      command: THREAD_COMMANDS.START,
      action: ROUTING_ACTIONS.START,
      state: ROUTING_DECISION_STATES.APPLIED,
      source: ROUTING_SOURCES.EXPLICIT_COMMAND,
      conversationId: "conversation-1",
      messageId: "message-1",
      targetThreadId: "thread-2",
      reason: "explicit-new-task",
      evidence: ["explicit_command:start"],
      now: 10
    });
    assert.ok(decision);
    assert.deepEqual(decision.evidence, ["explicit_command:start"]);
    assert.equal("message" in decision, false);
    assert.equal("content" in decision, false);
  });

  it("requires an active run for steering", () => {
    const invalid = {
      id: "decision-2",
      command: THREAD_COMMANDS.STEER,
      action: ROUTING_ACTIONS.STEER,
      state: ROUTING_DECISION_STATES.APPLIED,
      source: ROUTING_SOURCES.ACTIVE_RUN,
      conversationId: "conversation-1",
      targetThreadId: "thread-1"
    };
    assert.deepEqual(
      validateThreadRoutingDecision(invalid).errors,
      ["steer-active-run-required"]
    );
  });

  it("requires distinct fork and regeneration targets", () => {
    const invalidFork = createThreadRoutingDecision({
      id: "decision-3",
      command: THREAD_COMMANDS.FORK,
      action: ROUTING_ACTIONS.FORK,
      state: ROUTING_DECISION_STATES.APPLIED,
      conversationId: "conversation-1",
      sourceThreadId: "thread-1",
      sourceRunId: "run-1",
      targetThreadId: "thread-1"
    });
    assert.equal(invalidFork, null);

    const invalidRegeneration = createThreadRoutingDecision({
      id: "decision-4",
      command: THREAD_COMMANDS.REGENERATE,
      action: ROUTING_ACTIONS.REGENERATE,
      state: ROUTING_DECISION_STATES.APPLIED,
      conversationId: "conversation-1",
      targetThreadId: "thread-1",
      sourceRunId: "run-1",
      targetRunId: "run-1"
    });
    assert.equal(invalidRegeneration, null);
  });

  it("supports shadow comparison without taking over current routing", () => {
    const decision = createThreadRoutingDecision({
      id: "decision-5",
      command: THREAD_COMMANDS.RESUME,
      action: ROUTING_ACTIONS.RESUME,
      source: ROUTING_SOURCES.LEGACY_SHADOW,
      conversationId: "conversation-1",
      currentThreadId: "thread-1",
      reason: "shadow-only",
      legacyAction: ROUTING_ACTIONS.START,
      shadowMode: true,
      now: 10
    });
    assert.ok(decision);
    assert.deepEqual(decision.shadow, {
      enabled: true,
      legacyAction: "start",
      mismatch: true
    });
  });
});

describe("Phase A architecture boundary", () => {
  it("keeps the contract pure and disconnected from production routing", () => {
    const facadeSources = [
      read("electron/agent/AgentRuntime.js"),
      read("electron/agent/ExecutionThread.js"),
      read("electron/conversation/ConversationManager.js"),
      read("electron/conversation/services/ConversationExecutionService.js")
    ].join("\n");
    assert.doesNotMatch(facadeSources, /execution-model/u);
  });

  it("keeps Phase A modules independent from Agent and Conversation facades", () => {
    for (const file of [
      "electron/execution-model/ExecutionModelContract.js",
      "electron/execution-model/ThreadStateMachine.js",
      "electron/execution-model/RunIdentityContract.js",
      "electron/execution-model/ExecutionItemSchema.js",
      "electron/execution-model/ThreadRoutingDecision.js"
    ]) {
      const source = read(file);
      assert.doesNotMatch(source, /from "\.\.\/agent\//u, file);
      assert.doesNotMatch(source, /from "\.\.\/conversation\//u, file);
      assert.doesNotMatch(source, /from "\.\.\/platform\//u, file);
    }
  });
});
