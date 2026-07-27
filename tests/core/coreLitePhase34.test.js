import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  projectMessageForRead,
  sanitizeConversationData
} from "../../electron/conversation/conversationSchema.js";
import { ConversationManager } from "../../electron/conversation/ConversationManager.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

class MemoryStore {
  constructor(data) {
    this.data = sanitizeConversationData(data);
  }

  load() {
    return structuredClone(this.data);
  }

  save(data) {
    this.data = sanitizeConversationData(data);
    return this.load();
  }
}

function legacyPlanData() {
  return {
    version: 23,
    currentConversationId: "conversation-plan",
    conversations: [{
      id: "conversation-plan",
      title: "Legacy Plan",
      mode: "coding",
      createdAt: 1,
      updatedAt: 2,
      messages: [{
        id: "assistant-plan",
        role: "assistant",
        content: "Historical progress",
        status: "complete",
        createdAt: 2,
        plan: [{
          id: "inspect",
          title: "Inspect project",
          status: "completed"
        }],
        planState: {
          schemaVersion: 3,
          revision: 4,
          rootRevision: 2,
          rootItems: [{
            id: "inspect",
            title: "Inspect project",
            status: "completed"
          }],
          subplans: []
        }
      }]
    }]
  };
}

test("Core Lite 3.4 physically removes Plan Runtime and authority modules", () => {
  for (const relativePath of [
    "electron/agent/PlanAuthority.js",
    "electron/agent/planState.js",
    "electron/agent/orchestration/agentTools.js",
    "electron/config/coreLite.js",
    "tests/tools/planAuthority93.test.js",
    "tests/tools/planAuthorityAutoClose97.test.js",
    "tests/tools/planExecution.test.js",
    "tests/tools/planReplanning.test.js"
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  }
});

test("Core Lite 3.4 exposes no Plan tools, capabilities, scheduler barrier, or stop reason", () => {
  const sources = [
    "electron/tools/createAgentToolSession.js",
    "electron/tools/runtime/runtimeTools.js",
    "electron/tools/manifest/createBuiltinToolRegistry.js",
    "electron/tools/manifest/builtinToolPresentation.js",
    "electron/tools/capabilities/CapabilityMapping.js",
    "electron/tools/capabilities/CapabilityResolver.js",
    "electron/tools/capabilities/CapabilityTaxonomy.js",
    "electron/tools/core/ToolScheduler.js",
    "electron/tools/core/toolErrors.js",
    "electron/agent/ToolErrorClassifier.js",
    "electron/agent/runStopReasons.js",
    "src/shared/defaultSettings.js"
  ].map(read).join("\n");

  assert.doesNotMatch(
    sources,
    /update_plan|replan_goal|update_step_work|RunPlanStore|PlanAuthority|agent\.plan|PLAN_INCOMPLETE|PLAN_STEP_REQUIRED/u
  );
});

test("Core Lite 3.4 keeps historical Plan data as a bounded read-only snapshot", () => {
  const canonical = sanitizeConversationData(legacyPlanData());
  const message = canonical.conversations[0].messages[0];

  assert.equal(Object.hasOwn(message, "plan"), false);
  assert.equal(Object.hasOwn(message, "planState"), false);
  assert.equal(message.metadata.plan[0].id, "inspect");
  assert.equal(message.metadata.planState.readOnly, true);
  assert.equal(message.metadata.planState.rootItems[0].status, "completed");

  const projected = projectMessageForRead(message);
  assert.equal(projected.plan[0].title, "Inspect project");
  assert.equal(projected.planState.readOnly, true);
});

test("Core Lite 3.4 never accepts Plan state on new message writes", () => {
  const store = new MemoryStore({
    version: 24,
    currentConversationId: "conversation",
    conversations: [{
      id: "conversation",
      title: "New",
      mode: "chat",
      createdAt: 1,
      updatedAt: 1,
      messages: []
    }]
  });
  const manager = new ConversationManager({ store, now: () => 10 });

  const message = manager.appendMessage({
    conversationId: "conversation",
    role: "assistant",
    content: "New result",
    plan: [{ id: "forbidden", title: "Must not persist", status: "pending" }],
    planState: { rootItems: [{ id: "forbidden", status: "pending" }] }
  });

  assert.equal(Object.hasOwn(message.metadata ?? {}, "plan"), false);
  assert.equal(Object.hasOwn(message.metadata ?? {}, "planState"), false);
  const persisted = store.data.conversations[0].messages[0];
  assert.equal(Object.hasOwn(persisted.metadata ?? {}, "plan"), false);
  assert.equal(Object.hasOwn(persisted.metadata ?? {}, "planState"), false);
});

test("Core Lite 3.4 removes Plan from execution, finalization, outcome, and activity control", () => {
  const sources = [
    "electron/agent/execution/AgentRunExecution.js",
    "electron/agent/execution/CoreLiteRunLoop.js",
    "electron/agent/AgentRuntime.js",
    "electron/agent/finalization.js",
    "electron/agent/finalization/AgentRunFinalization.js",
    "electron/agent/finalization/CompletionEvidenceGate.js",
    "electron/agent/RunOutcomeResolver.js",
    "electron/agent/RunActivityStore.js",
    "electron/agent/CoreLiteCheckpoint.js",
    "electron/tools/runtime-state/ToolExecutionLedger.js",
    "src/shared/hooks/useAgentStatus.js"
  ].map(read).join("\n");

  assert.doesNotMatch(
    sources,
    /getPlanCompletionState|recordPlan|initialPlan|initialPlanState|planStore|goalVerification|completedPlanSteps|totalPlanSteps|plan:\s*\[\]|PLAN_/u
  );
});

test("Core Lite 3.4 historical Plan survives JSON persistence without regaining authority", () => {
  const first = sanitizeConversationData(legacyPlanData());
  const second = sanitizeConversationData(JSON.parse(JSON.stringify(first)));
  const message = second.conversations[0].messages[0];

  assert.equal(Object.hasOwn(message, "plan"), false);
  assert.equal(Object.hasOwn(message, "planState"), false);
  assert.equal(message.metadata.planState.readOnly, true);
  assert.equal(projectMessageForRead(message).plan[0].id, "inspect");
});
