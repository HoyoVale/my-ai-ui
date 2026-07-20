import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Conversation exposes a reviewable Tool Approval flow", () => {
  const conversation = read("../../src/Conversation/Conversation.jsx");
  const panel = read("../../src/Conversation/components/ToolApprovalPanel.jsx");
  const preload = read("../../electron/preload/preload.cjs");
  const agentIpc = read("../../electron/ipc/handlers/agentIpc.js");

  assert.match(conversation, /<ToolApprovalPanel/u);
  assert.match(panel, /tool-approval-allow-once/u);
  assert.match(panel, /tool-approval-allow-run/u);
  assert.match(panel, /tool-approval-deny/u);
  assert.match(preload, /resolveToolApproval/u);
  assert.match(agentIpc, /RESOLVE_TOOL_APPROVAL/u);
  assert.match(agentIpc, /Only the Conversation window/u);
});

test("MCP diagnostics remain behind developer mode", () => {
  const panel = read("../../src/Setting/panels/McpPanel.jsx");
  const ipc = read("../../electron/ipc/handlers/mcpIpc.js");

  assert.match(panel, /developerMode &&/u);
  assert.match(panel, /mcp-diagnostic-grid/u);
  assert.match(panel, /疑似提示词注入/u);
  assert.match(ipc, /logs: developerMode \? item\.logs : \[\]/u);
  assert.match(ipc, /security: developerMode \? item\.security : null/u);
});
