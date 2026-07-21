import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const conversation = fs.readFileSync(
  new URL("../../src/Conversation/Conversation.jsx", import.meta.url),
  "utf8"
);
const topbar = fs.readFileSync(
  new URL("../../src/Conversation/components/Topbar.jsx", import.meta.url),
  "utf8"
);
const taskPanel = fs.readFileSync(
  new URL("../../src/Conversation/components/TaskPanel.jsx", import.meta.url),
  "utf8"
);
const toolPanel = fs.readFileSync(
  new URL("../../src/Setting/panels/ToolPanel.jsx", import.meta.url),
  "utf8"
);

test("Conversation no longer exposes the obsolete global Recovery Center", () => {
  assert.doesNotMatch(topbar, /conversation-recovery-toggle/u);
  assert.doesNotMatch(conversation, /ConversationRecoveryPanel/u);
  assert.doesNotMatch(conversation, /getToolRuntimeRecoveryHistory/u);
});

test("developer run details are loaded only after an explicit request", () => {
  assert.match(taskPanel, /data-testid="conversation-load-run-details"/u);
  assert.match(taskPanel, /const loadDeveloperDetails = async/u);
  assert.match(taskPanel, /onLoad=\{\(\) => void loadDeveloperDetails\(\)\}/u);
  assert.match(taskPanel, /onClick=\{onLoad\}/u);
  assert.match(taskPanel, /运行诊断尚未载入/u);
});

test("circuit breaker settings include half-open limits and manual reset", () => {
  assert.match(toolPanel, /halfOpenMaxCalls/u);
  assert.match(toolPanel, /data-testid="circuit-breaker-reset-all"/u);
  assert.match(toolPanel, /resetCircuitBreaker/u);
});
