import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(
      relativePath,
      import.meta.url
    ),
    "utf8"
  );
}

describe(
  "Tool UX developer-mode contract",
  () => {
    it(
      "keeps ordinary Tool settings focused on Chat, Coding and workspaces",
      () => {
        const panel = read(
          "../../src/Setting/panels/ToolPanel.jsx"
        );

        assert.match(panel, /TOOL_MODE_OPTIONS/u);
        assert.match(panel, /Chat/u);
        assert.match(panel, /Coding/u);
        assert.match(panel, /添加工作区/u);
        assert.match(panel, /tool-display-detail/u);
        assert.doesNotMatch(
          panel,
          /启用工具调用/u
        );
      }
    );

    it(
      "shows Toolset overrides and every tool description only in developer mode",
      () => {
        const panel = read(
          "../../src/Setting/panels/ToolPanel.jsx"
        );

        assert.match(
          panel,
          /developerMode &&/u
        );
        assert.match(
          panel,
          /tool\.description/u
        );
        assert.match(
          panel,
          /TOOL_OVERRIDE_OPTIONS/u
        );
        assert.match(
          panel,
          /tool-developer-settings/u
        );
      }
    );

    it(
      "gates the Developer navigation and Context advanced controls",
      () => {
        const general = read(
          "../../src/Setting/panels/GeneralPanel.jsx"
        );
        const sidebar = read(
          "../../src/Setting/components/Sidebar.jsx"
        );
        const context = read(
          "../../src/Setting/panels/ConversationPanel.jsx"
        );

        assert.match(general, /developer-mode/u);
        assert.match(sidebar, /developerOnly/u);
        assert.match(
          context,
          /context-developer-settings/u
        );
        assert.match(
          context,
          /共享完整工作区路径/u
        );
      }
    );

    it(
      "renders compact tool activity, developer raw details and persisted plans",
      () => {
        const list = read(
          "../../src/Conversation/components/MessageList.jsx"
        );

        assert.match(
          list,
          /已使用 \{toolCalls\.length\} 个工具/u
        );
        assert.match(
          list,
          /conversation-tool-call--developer/u
        );
        assert.match(
          list,
          /AgentPlan/u
        );
        assert.match(
          list,
          /message\.plan/u
        );
      }
    );
  }
);
