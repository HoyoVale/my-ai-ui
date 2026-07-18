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
      "adds a dedicated Tools page with progressive disclosure",
      () => {
        const tabs = read(
          "../../src/Setting/constants/Tabs.js"
        );
        const panel = read(
          "../../src/Setting/panels/ToolPanel.jsx"
        );

        assert.match(
          tabs,
          /id: "tools"/u
        );
        assert.match(
          panel,
          /Safe Tool Runtime/u
        );
        assert.match(
          panel,
          /读取与搜索上限/u
        );
        assert.match(
          panel,
          /单个工具/u
        );
        assert.match(
          panel,
          /selectWorkspaceDirectory/u
        );
      }
    );

    it(
      "places environment injection controls inside Context",
      () => {
        const panel = read(
          "../../src/Setting/panels/ConversationPanel.jsx"
        );

        assert.match(
          panel,
          /运行环境上下文/u
        );
        assert.match(
          panel,
          /runtime-context-profile/u
        );
        assert.match(
          panel,
          /workspaceDetail/u
        );
        assert.match(
          panel,
          /toolDetail/u
        );
        assert.match(
          panel,
          /conversationSettings\s*\.contextTurns/u
        );
        assert.doesNotMatch(
          panel,
          /\bsettings\s*\.contextTurns/u
        );
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

        assert.match(
          agent,
          /maxSteps/u
        );
        assert.match(
          agent,
          /saveToolHistory/u
        );
        assert.match(
          executor,
          /defaultTimeoutMs/u
        );
        assert.match(
          executor,
          /TOOL_TIMEOUT/u
        );
      }
    );
  }
);
