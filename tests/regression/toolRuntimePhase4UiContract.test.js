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

test("Conversation exposes an independent Recovery Center entrance", () => {
  assert.match(topbar, /data-testid="conversation-recovery-toggle"/u);
  assert.match(conversation, /ConversationRecoveryPanel/u);
  assert.match(conversation, /getToolRuntimeRecoveryHistory/u);
  assert.match(conversation, /recoveryCount=/u);
});

test("developer run details are loaded only after an explicit request", () => {
  assert.match(taskPanel, /data-testid="conversation-load-run-details"/u);
  assert.match(taskPanel, /onLoadDeveloperDetails/u);
  assert.match(taskPanel, /运行诊断尚未载入/u);
  assert.doesNotMatch(taskPanel, /useEffect\([\s\S]{0,500}onLoadDeveloperDetails/u);
});

test("circuit breaker settings include half-open limits and manual reset", () => {
  assert.match(toolPanel, /halfOpenMaxCalls/u);
  assert.match(toolPanel, /data-testid="circuit-breaker-reset-all"/u);
  assert.match(toolPanel, /resetCircuitBreaker/u);
});
