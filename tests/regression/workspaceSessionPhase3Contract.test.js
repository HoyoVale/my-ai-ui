import {
  readConversationShellSource
} from "../helpers/conversationUiSource.js";

import {
  describe,
  it
} from "node:test";

import assert
  from "node:assert/strict";

import fs from "node:fs";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

function read(relativePath) {
  return fs.readFileSync(
    new URL(relativePath, import.meta.url),
    "utf8"
  );
}

describe(
  "workspace and session navigation contract",
  () => {
    it(
      "keeps workspace registration in work context and also exposes safe Input registration",
      () => {
        const tabs = read(
          "../../src/Setting/constants/Tabs.js"
        );
        const contextPanel = read(
          "../../src/Setting/panels/WorkContextPanel.jsx"
        );
        const inputMenu = read(
          "../../src/Input/components/ContextMenu.jsx"
        );
        const inputContext = read(
          "../../src/Input/hooks/useInputContext.js"
        );
        const workspaceIpc = read(
          "../../electron/ipc/handlers/workspaceIpc.js"
        );

        assert.match(tabs, /id: "workspace"/u);
        assert.match(contextPanel, /registerWorkspace/u);
        assert.match(inputMenu, /input-add-workspace/u);
        assert.match(inputContext, /selectWorkspaceDirectory/u);
        assert.match(workspaceIpc, /isInputSender/u);
      }
    );

    it(
      "uses Chat and Coding tabs then collapsible workspace groups in Conversation",
      () => {
        const sidebar = read(
          "../../src/Conversation/components/Sidebar.jsx"
        );
        const conversation = readConversationShellSource();

        assert.match(sidebar, /conversation-mode-tabs/u);
        assert.match(sidebar, /conversation-workspace-group__toggle/u);
        assert.match(sidebar, /groupSessionsByWorkspace/u);
        assert.doesNotMatch(sidebar, /conversation-workspace-select/u);
        assert.doesNotMatch(sidebar, /conversation-history-item__workspace/u);
        assert.match(conversation, /sidebarMode/u);
      }
    );

    it(
      "replaces three permanent Input selects with one multilevel plus menu",
      () => {
        const composer = read(
          "../../src/Input/components/Composer.jsx"
        );
        const contextMenu = read(
          "../../src/Input/components/ContextMenu.jsx"
        );
        const input = read(
          "../../src/Input/Input.jsx"
        );

        assert.match(composer, /InputContextMenu/u);
        assert.doesNotMatch(composer, /input-mode-select/u);
        assert.doesNotMatch(composer, /input-workspace-select/u);
        assert.doesNotMatch(composer, /input-model-select/u);
        assert.match(contextMenu, /input-context-menu-trigger/u);
        assert.match(contextMenu, /renderPageHeader\("模式"\)/u);
        assert.match(contextMenu, /renderPageHeader\("工作区"\)/u);
        assert.match(contextMenu, /renderPageHeader\("会话"\)/u);
        assert.match(contextMenu, /renderPageHeader\("模型"\)/u);
        assert.match(contextMenu, /新建会话/u);
        assert.match(contextMenu, /添加工作区/u);
        assert.match(input, /selectSession/u);
        assert.match(input, /createSession/u);
      }
    );

    it(
      "keeps the model-selected execution conversation in scope for the whole run",
      () => {
        const runtime = readAgentRuntimeSource();

        assert.match(runtime, /let executionConversation;/u);
        assert.match(runtime, /resolveConversationExecutionContext/u);
        assert.match(runtime, /overrides: continuationState \?\? \{\}/u);
        assert.match(runtime, /executionConversation = execution\.conversation/u);
        assert.match(runtime, /modelSelection:/u);
      }
    );
  }
);
