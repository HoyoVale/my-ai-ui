import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    "utf8"
  );
}

describe(
  "workspace session phase 3 contract",
  () => {
    it(
      "moves mode and workspace management into a dedicated work context page",
      () => {
        const tabs = read(
          "../../src/Setting/constants/Tabs.js"
        );
        const contextPanel = read(
          "../../src/Setting/panels/WorkContextPanel.jsx"
        );
        const toolPanel = read(
          "../../src/Setting/panels/ToolPanel.jsx"
        );

        assert.match(tabs, /id: "workspace"/u);
        assert.match(contextPanel, /TOOL_MODE_OPTIONS/u);
        assert.match(contextPanel, /registerWorkspace/u);
        assert.match(contextPanel, /removeWorkspace/u);
        assert.doesNotMatch(toolPanel, /添加工作区|TOOL_MODE_OPTIONS/u);
      }
    );

    it(
      "binds conversations to workspace ids and switches by creating a new session",
      () => {
        const schema = read(
          "../../electron/conversation/conversationSchema.js"
        );
        const manager = read(
          "../../electron/conversation/ConversationManager.js"
        );
        const sidebar = read(
          "../../src/Conversation/components/Sidebar.jsx"
        );

        assert.match(schema, /workspaceId/u);
        assert.match(schema, /workspaceSnapshot/u);
        assert.match(manager, /switchWorkspace/u);
        assert.match(manager, /this\.create\(\{/u);
        assert.match(sidebar, /conversation-workspace-select/u);
        assert.match(sidebar, /conversation-workspace-group/u);
      }
    );

    it(
      "binds Tool Runtime and checkpoints to the session workspace",
      () => {
        const runtime = read(
          "../../electron/agent/AgentRuntime.js"
        );
        const checkpoint = read(
          "../../electron/agent/runCheckpoint.js"
        );
        const resultStore = read(
          "../../electron/tools/core/ToolResultStore.js"
        );

        assert.match(
          runtime,
          /bindSettingsToConversationWorkspace/u
        );
        assert.match(runtime, /workspaceId/u);
        assert.match(checkpoint, /workspaceSnapshot/u);
        assert.match(resultStore, /owner\.workspaceId/u);
      }
    );
  }
);
