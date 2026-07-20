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
  "Tool and runtime context Setting contract",
  () => {
    it(
      "keeps user Tool controls visible and runtime insurance in developer mode",
      () => {
        const tabs = read(
          "../../src/Setting/constants/Tabs.js"
        );
        const panel = read(
          "../../src/Setting/panels/ToolPanel.jsx"
        );
        const workspacePanel = read(
          "../../src/Setting/panels/WorkContextPanel.jsx"
        );

        assert.match(tabs, /id: "tools"/u);
        assert.match(panel, /title="工具"/u);
        assert.match(panel, /title="工具清单"/u);
        assert.match(panel, /useToolManifest/u);
        assert.match(panel, /tool-manifest-card/u);
        assert.match(panel, /tool-advanced-settings/u);
        assert.match(panel, /developerMode &&/u);
        assert.match(panel, /tool-developer-settings/u);
        assert.match(workspacePanel, /会话按 Chat 与 Coding 管理/u);
        assert.match(workspacePanel, /selectWorkspaceDirectory/u);
      }
    );

    it(
      "keeps Electron E2E selectors aligned with the manifest-driven Tool UI",
      () => {
        const flow = read(
          "../e2e/conversation-flow.cjs"
        );

        assert.match(flow, /tool-manifest-calculator/u);
        assert.match(flow, /tool-override-calculator/u);
        assert.doesNotMatch(flow, /tool-developer-overrides/u);
      }
    );

    it(
      "places environment injection controls inside Context",
      () => {
        const panel = read(
          "../../src/Setting/panels/ConversationPanel.jsx"
        );

        assert.match(panel, /运行环境上下文/u);
        assert.match(panel, /context-developer-settings/u);
        assert.match(panel, /workspaceDetail/u);
        assert.match(panel, /toolDetail/u);
        assert.match(panel, /conversationSettings\s*\.contextTurns/u);
        assert.doesNotMatch(panel, /\bsettings\s*\.contextTurns/u);
      }
    );

    it(
      "wires runtime limits into AgentRuntime and ToolExecutor",
      () => {
        const agent = read(
          "../../electron/agent/AgentRuntime.js"
        );
        const executor = read(
          "../../electron/tools/core/ToolExecutor.js"
        );

        assert.match(agent, /maxSteps/u);
        assert.match(agent, /saveToolHistory/u);
        assert.match(executor, /defaultTimeoutMs/u);
        assert.match(executor, /TOOL_TIMEOUT/u);
      }
    );
  }
);
