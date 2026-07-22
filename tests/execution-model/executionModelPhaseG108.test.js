import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it, test } from "node:test";

import {
  ExecutionThreadRouter,
  ROUTING_ACTIONS,
  ROUTING_DECISION_STATES,
  ROUTING_ROLLOUT_MODES,
  RoutingRolloutController,
  ThreadRoutingDecisionStore,
  createThreadRoutingDecision,
  evaluateRoutingRollout,
  sanitizeRoutingDecision,
  sanitizeRoutingRolloutSettings,
  summarizeRoutingRollout,
  validateRoutingAuthoritySafety
} from "../../electron/execution-model/index.js";

import {
  sanitizeSettings
} from "../../electron/settings/validateSettings.js";

import {
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";

function conversation(overrides = {}) {
  const thread = {
    id: "thread-1",
    taskId: "task-1",
    status: "waiting",
    workspaceId: "workspace-1",
    lastRunId: "run-1",
    runs: [{
      id: "run-1",
      threadId: "thread-1",
      sequence: 1,
      state: "continuable",
      relation: "initial",
      createdAt: 1,
      updatedAt: 2
    }]
  };
  return {
    id: "conversation-1",
    workspaceId: "workspace-1",
    activeExecutionThreadId: "thread-1",
    executionThreads: [thread],
    executionThread: thread,
    ...overrides
  };
}

function decision(overrides = {}) {
  return createThreadRoutingDecision({
    id: overrides.id ?? "decision-1",
    command: overrides.command ?? "resume",
    action: overrides.action ?? ROUTING_ACTIONS.RESUME,
    source: overrides.source ?? "active_thread",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    currentThreadId: "thread-1",
    targetThreadId: "thread-1",
    sourceRunId: "run-1",
    targetRunId: overrides.targetRunId ?? "run-2",
    reason: overrides.reason ?? "resume-current-thread",
    evidence: overrides.evidence ?? ["thread-state:waiting"],
    legacyAction: overrides.legacyAction ?? ROUTING_ACTIONS.RESUME,
    shadowMode: true,
    rollout: overrides.rollout ?? null,
    now: overrides.now ?? 100
  });
}

function healthyHistory(count = 12) {
  return Array.from({ length: count }, (_, index) => decision({
    id: `healthy-${index}`,
    now: index + 1
  }));
}

describe("Phase G rollout settings", () => {
  it("defaults to guarded authority with bounded rollback thresholds", () => {
    const settings = sanitizeSettings({});
    assert.deepEqual(settings.conversation.executionRouting, {
      mode: ROUTING_ROLLOUT_MODES.GUARDED,
      minimumSamples: 12,
      maxMismatchRate: 0.35,
      maxHighRiskMismatches: 0,
      windowSize: 100,
      autoRollback: true
    });
  });

  it("sanitizes every rollout mode and clamps unsafe thresholds", () => {
    const settings = sanitizeSettings({
      conversation: {
        executionRouting: {
          mode: ROUTING_ROLLOUT_MODES.AUTHORITY,
          minimumSamples: -10,
          maxMismatchRate: 4,
          maxHighRiskMismatches: 999,
          windowSize: 2,
          autoRollback: false
        }
      }
    }).conversation.executionRouting;
    assert.equal(settings.mode, ROUTING_ROLLOUT_MODES.AUTHORITY);
    assert.equal(settings.minimumSamples, 0);
    assert.equal(settings.maxMismatchRate, 1);
    assert.equal(settings.maxHighRiskMismatches, 100);
    assert.equal(settings.windowSize, 20);
    assert.equal(settings.autoRollback, false);
    assert.equal(sanitizeRoutingRolloutSettings({ mode: "invalid" }).mode, "guarded");
  });
});

describe("RoutingRolloutPolicy", () => {
  it("lets the new router own an agreed safe resume", () => {
    const result = evaluateRoutingRollout({
      decision: decision(),
      conversation: conversation(),
      settings: { mode: "guarded" }
    });
    assert.equal(result.authority, true);
    assert.equal(result.effectiveAction, ROUTING_ACTIONS.RESUME);
    assert.equal(result.reason, "legacy-and-router-agree");
  });

  it("warms up before applying a low-risk mismatch", () => {
    const result = evaluateRoutingRollout({
      decision: decision({
        legacyAction: ROUTING_ACTIONS.START,
        reason: "feedback-on-current-thread",
        source: "semantic_fallback"
      }),
      conversation: conversation(),
      settings: { mode: "guarded", minimumSamples: 12 },
      history: healthyHistory(3)
    });
    assert.equal(result.authority, false);
    assert.equal(result.effectiveAction, ROUTING_ACTIONS.START);
    assert.equal(result.reason, "guarded-rollout-warming-up");
  });

  it("applies explicit start commands immediately in guarded mode", () => {
    const explicitStart = createThreadRoutingDecision({
      id: "explicit-start",
      command: "start",
      action: ROUTING_ACTIONS.START,
      source: "explicit_command",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
      currentThreadId: "thread-1",
      reason: "explicit-start-new-thread",
      evidence: ["message-intent:start"],
      legacyAction: ROUTING_ACTIONS.RESUME,
      shadowMode: true,
      now: 100
    });
    const result = evaluateRoutingRollout({
      decision: explicitStart,
      conversation: conversation(),
      settings: { mode: "guarded", minimumSamples: 12 },
      history: []
    });
    assert.equal(result.authority, true);
    assert.equal(result.effectiveAction, ROUTING_ACTIONS.START);
    assert.equal(result.reason, "guarded-safety-override");
  });

  it("applies a low-risk mismatch after a healthy observation window", () => {
    const result = evaluateRoutingRollout({
      decision: decision({
        legacyAction: ROUTING_ACTIONS.START,
        reason: "feedback-on-current-thread",
        source: "semantic_fallback"
      }),
      conversation: conversation(),
      settings: {
        mode: "guarded",
        minimumSamples: 12,
        maxMismatchRate: 0.35
      },
      history: healthyHistory(12)
    });
    assert.equal(result.authority, true);
    assert.equal(result.effectiveAction, ROUTING_ACTIONS.RESUME);
    assert.equal(result.reason, "guarded-rollout-threshold-met");
  });

  it("never cuts over a high-risk mismatch", () => {
    const highRisk = decision({
      action: ROUTING_ACTIONS.RESUME,
      legacyAction: ROUTING_ACTIONS.REJECT,
      reason: "resume-current-thread"
    });
    const result = evaluateRoutingRollout({
      decision: highRisk,
      conversation: conversation(),
      settings: { mode: "authority", minimumSamples: 0 },
      history: healthyHistory(20)
    });
    assert.equal(result.authority, false);
    assert.equal(result.effectiveAction, ROUTING_ACTIONS.REJECT);
    assert.equal(result.reason, "high-risk-routing-mismatch");
  });

  it("automatically rolls back when the historical window is unhealthy", () => {
    const unhealthy = Array.from({ length: 12 }, (_, index) => decision({
      id: `unhealthy-${index}`,
      legacyAction: ROUTING_ACTIONS.REJECT,
      reason: "resume-current-thread",
      now: index + 1
    }));
    const result = evaluateRoutingRollout({
      decision: decision(),
      conversation: conversation(),
      settings: {
        mode: "authority",
        minimumSamples: 10,
        maxMismatchRate: 0.2,
        maxHighRiskMismatches: 0,
        autoRollback: true
      },
      history: unhealthy
    });
    assert.equal(result.autoRollback, true);
    assert.equal(result.authority, false);
    assert.equal(result.reason, "rollout-health-threshold-exceeded");
  });

  it("blocks cross-workspace resume authority", () => {
    const mismatched = conversation({ workspaceId: "workspace-2" });
    const safety = validateRoutingAuthoritySafety({
      decision: decision(),
      conversation: mismatched
    });
    assert.equal(safety.ok, false);
    assert.equal(safety.reason, "target-thread-workspace-mismatch");
  });

  it("blocks duplicate regeneration run identities", () => {
    const regeneration = decision({
      command: "regenerate",
      action: ROUTING_ACTIONS.REGENERATE,
      legacyAction: ROUTING_ACTIONS.REGENERATE,
      reason: "regenerate-existing-run",
      targetRunId: "run-1"
    });
    const safety = validateRoutingAuthoritySafety({
      decision: regeneration,
      conversation: conversation()
    });
    assert.equal(safety.ok, false);
    assert.match(safety.reason, /must-differ|already-exists/u);
  });

  it("keeps steer and fork outside production rollout", () => {
    for (const action of [ROUTING_ACTIONS.STEER, ROUTING_ACTIONS.FORK]) {
      const result = evaluateRoutingRollout({
        decision: decision({
          command: action,
          action,
          legacyAction: ROUTING_ACTIONS.REJECT,
          reason: `${action}-routing-decision`
        }),
        conversation: conversation(),
        settings: { mode: "authority", minimumSamples: 0 }
      });
      assert.equal(result.authority, false);
      assert.equal(result.effectiveAction, ROUTING_ACTIONS.REJECT);
    }
  });
});

describe("RoutingRolloutController and persistence", () => {
  it("decorates decisions without mutating router output", () => {
    const store = new ThreadRoutingDecisionStore();
    const controller = new RoutingRolloutController({ decisionStore: store });
    const original = decision();
    const evaluated = controller.evaluate({
      decision: original,
      conversation: conversation(),
      settings: { mode: "guarded" }
    });
    assert.equal(original.rollout, null);
    assert.equal(evaluated.rollout.authority, true);
    assert.equal(evaluated.rollout.effectiveAction, ROUTING_ACTIONS.RESUME);
  });

  it("persists rollout audit metadata across sanitization", () => {
    const evaluated = new RoutingRolloutController({
      decisionStore: new ThreadRoutingDecisionStore()
    }).evaluate({
      decision: decision(),
      conversation: conversation(),
      settings: { mode: "guarded" }
    });
    const applied = createThreadRoutingDecision({
      ...evaluated,
      state: ROUTING_DECISION_STATES.APPLIED,
      shadowMode: true,
      legacyAction: evaluated.shadow.legacyAction,
      now: evaluated.createdAt
    });
    const persisted = sanitizeRoutingDecision(JSON.parse(JSON.stringify(applied)));
    assert.equal(persisted.state, ROUTING_DECISION_STATES.APPLIED);
    assert.equal(persisted.rollout.mode, ROUTING_ROLLOUT_MODES.GUARDED);
    assert.equal(persisted.rollout.authority, true);
    assert.equal(persisted.rollout.effectiveAction, ROUTING_ACTIONS.RESUME);
  });

  it("persists rollout metadata through the Conversation v23 schema", () => {
    const evaluated = new RoutingRolloutController({
      decisionStore: new ThreadRoutingDecisionStore()
    }).evaluate({
      decision: decision(),
      conversation: conversation(),
      settings: { mode: "guarded" }
    });
    const data = sanitizeConversationData({
      version: 23,
      currentConversationId: "conversation-1",
      conversations: [{
        id: "conversation-1",
        title: "Routing",
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        routingDecisions: [evaluated]
      }]
    });
    const persisted = data.conversations[0].routingDecisions[0];
    assert.equal(persisted.rollout.mode, "guarded");
    assert.equal(persisted.rollout.authority, true);
    assert.equal(persisted.rollout.effectiveAction, "resume");
  });

  it("reports authority, fallback, mismatch, and rollback metrics", () => {
    const store = new ThreadRoutingDecisionStore();
    const authoritative = decision({
      id: "authority",
      rollout: {
        mode: "guarded",
        eligible: true,
        authority: true,
        effectiveAction: "resume",
        fallbackAction: "resume",
        reason: "legacy-and-router-agree",
        risk: "none",
        metrics: {}
      }
    });
    const fallback = decision({
      id: "fallback",
      legacyAction: ROUTING_ACTIONS.START,
      reason: "feedback-on-current-thread",
      rollout: {
        mode: "guarded",
        eligible: true,
        authority: false,
        effectiveAction: "start",
        fallbackAction: "start",
        reason: "guarded-rollout-warming-up",
        risk: "low",
        autoRollback: true,
        metrics: {}
      }
    });
    store.record(authoritative);
    store.record(fallback);
    const snapshot = store.snapshot();
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.total, 2);
    assert.equal(snapshot.authorityCount, 1);
    assert.equal(snapshot.fallbackCount, 1);
    assert.equal(snapshot.autoRollbackCount, 1);
    assert.equal(snapshot.byEffectiveAction.resume, 1);
    assert.equal(snapshot.byEffectiveAction.start, 1);
    assert.equal(summarizeRoutingRollout(snapshot.decisions).sampleSize, 2);
  });
});

test("Phase G integrates guarded authority without exposing controls in normal UI", () => {
  const preparation = fs.readFileSync(
    new URL("../../electron/agent/preparation/AgentRunPreparation.js", import.meta.url),
    "utf8"
  );
  const developerPanel = fs.readFileSync(
    new URL("../../src/Conversation/components/DeveloperActivityPanel.jsx", import.meta.url),
    "utf8"
  );
  const ordinaryTimeline = fs.readFileSync(
    new URL("../../src/Conversation/components/ActivityTimeline.jsx", import.meta.url),
    "utf8"
  );
  assert.match(preparation, /routingRolloutController\.evaluate/u);
  assert.match(preparation, /effectiveRoutingAction/u);
  assert.match(preparation, /ROUTING_DECISION_STATES\.APPLIED/u);
  assert.doesNotMatch(preparation, /steeringQueue\.enqueue/u);
  assert.match(developerPanel, /Thread routing rollout/u);
  assert.doesNotMatch(ordinaryTimeline, /Thread routing rollout|executionRouting/u);
});

test("Phase G replay keeps one deterministic decision per input", () => {
  let id = 0;
  const router = new ExecutionThreadRouter({
    createId: () => `decision-${++id}`,
    now: () => id
  });
  const inputs = ["请继续", "新任务：解释 Docker", "还是不对"];
  const decisions = inputs.map((message) => router.route({
    conversation: conversation(),
    message,
    legacyAction: message.startsWith("新任务")
      ? ROUTING_ACTIONS.START
      : ROUTING_ACTIONS.RESUME,
    shadowMode: true
  }));
  assert.equal(decisions.length, 3);
  assert.equal(new Set(decisions.map((item) => item.id)).size, 3);
  assert.deepEqual(decisions.map((item) => item.action), [
    ROUTING_ACTIONS.RESUME,
    ROUTING_ACTIONS.START,
    ROUTING_ACTIONS.RESUME
  ]);
});
