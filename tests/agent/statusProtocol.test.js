import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAgentStatusPatch,
  applyAgentTextEvent,
  createAgentStatusPatch,
  createAgentTextEvents,
  resolveAgentStatusRevision
} from "../../src/shared/agentStatusProtocol.js";

test("incremental Agent status separates text from structural patches", () => {
  const previous = {
    state: "running",
    runId: "run-1",
    liveStepText: "Hello",
    finalText: "",
    plan: [{ id: "p1", title: "Read", status: "in_progress" }],
    activity: {
      status: "running",
      events: [{ id: "e1", sequence: 1, type: "commentary", content: "Start" }]
    }
  };
  const next = {
    ...previous,
    liveStepText: "Hello world",
    plan: [{ id: "p1", title: "Read", status: "completed" }],
    activity: {
      status: "running",
      events: [
        previous.activity.events[0],
        { id: "e2", sequence: 2, type: "tool", status: "completed" }
      ]
    }
  };

  const textEvents = createAgentTextEvents(previous, next, {
    revision: 4,
    target: "response"
  });
  const patch = createAgentStatusPatch(previous, next, {
    revision: 4,
    target: "response"
  });

  assert.deepEqual(textEvents, [{
    version: 1,
    revision: 4,
    target: "response",
    runId: "run-1",
    conversationId: "",
    field: "liveStepText",
    operation: "append",
    text: " world"
  }]);
  assert.equal(Object.hasOwn(patch.changes, "liveStepText"), false);
  assert.equal(patch.collections.activity.events.upsert.length, 1);

  const withText = applyAgentTextEvent(previous, textEvents[0]);
  const restored = applyAgentStatusPatch(withText, patch);
  assert.equal(restored.liveStepText, "Hello world");
  assert.equal(restored.assistantText, "Hello world");
  assert.equal(restored.plan[0].status, "completed");
  assert.deepEqual(
    restored.activity.events.map((event) => event.id),
    ["e1", "e2"]
  );
});

test("incremental text uses replacement when a stream is rewritten", () => {
  const [event] = createAgentTextEvents(
    { runId: "run-1", finalText: "draft", liveStepText: "" },
    { runId: "run-1", finalText: "final answer", liveStepText: "" },
    { revision: 8, target: "response" }
  );

  assert.equal(event.operation, "replace");
  assert.equal(event.text, "final answer");
  assert.equal(
    applyAgentTextEvent({ finalText: "draft" }, event).finalText,
    "final answer"
  );
});


test("a delayed revision-zero snapshot cannot overwrite a newer patch", () => {
  assert.deepEqual(
    resolveAgentStatusRevision(3, { revision: 0 }),
    { accepted: false, revision: 3 }
  );
  assert.deepEqual(
    resolveAgentStatusRevision(3, { revision: 3 }),
    { accepted: true, revision: 3 }
  );
  assert.deepEqual(
    resolveAgentStatusRevision(3, { revision: 4 }),
    { accepted: true, revision: 4 }
  );
});
