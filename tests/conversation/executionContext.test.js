import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    "utf8"
  );
}

describe("conversation execution context contract", () => {
  it("makes one resolver authoritative for session mode, workspace and model", () => {
    const source = read(
      "../../electron/conversation/executionContext.js"
    );
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );
    const toolIpc = read(
      "../../electron/ipc/handlers/toolIpc.js"
    );
    const promptInspector = read(
      "../../electron/context/promptInspector.js"
    );
    const contextInspector = read(
      "../../electron/context/contextInspector.js"
    );

    assert.match(source, /bindSettingsToConversationWorkspace/u);
    assert.match(source, /CONVERSATION_TOOL_MODE_MISMATCH/u);
    assert.match(source, /resolvedMode !== expectedMode/u);
    assert.match(runtime, /resolveConversationExecutionContext/u);
    assert.match(toolIpc, /resolveConversationExecutionContext/u);
    assert.match(promptInspector, /resolveConversationExecutionContext/u);
    assert.match(contextInspector, /resolveConversationExecutionContext/u);
  });

  it("restores historical recovery mode, workspace and model from checkpoints", () => {
    const source = read(
      "../../electron/conversation/executionContext.js"
    );
    const runtime = read(
      "../../electron/agent/AgentRuntime.js"
    );

    assert.match(source, /getRecoveryExecutionOverrides/u);
    assert.match(source, /checkpoint\.mode/u);
    assert.match(source, /checkpoint\.workspaceId/u);
    assert.match(source, /checkpoint\.modelSelection/u);
    assert.match(runtime, /getTaskRuntimeRecord/u);
    assert.match(runtime, /getRecoveryExecutionOverrides\(record\.message\)/u);
    assert.match(runtime, /workspaceId: execution\.conversation\.workspaceId/u);
  });
});
