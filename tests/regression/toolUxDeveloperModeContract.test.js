import {
  readConversationMessageSource,
  readConversationTaskPanelSource
} from "../helpers/conversationUiSource.js";

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
      "keeps ordinary Tool settings available while hiding runtime insurance",
      () => {
        const panel = read(
          "../../src/Setting/panels/ToolPanel.jsx"
        );
        const workspacePanel = read(
          "../../src/Setting/panels/WorkContextPanel.jsx"
        );

        assert.match(workspacePanel, /Chat/u);
        assert.match(workspacePanel, /Coding/u);
        assert.match(workspacePanel, /添加工作区/u);
        assert.match(panel, /启用工具/u);
        assert.match(panel, /工具清单/u);
        assert.match(panel, /useToolManifest/u);
        assert.match(panel, /tool-manifest/u);
        assert.match(panel, /高级设置/u);
        assert.match(panel, /developerMode &&/u);
        assert.doesNotMatch(panel, /展示层级|活动显示/u);
        assert.doesNotMatch(panel, /包含应用启动目录|includeProjectRoot/u);
      }
    );

    it(
      "keeps forced Tool overrides and runtime boundaries developer-only",
      () => {
        const panel = read(
          "../../src/Setting/panels/ToolPanel.jsx"
        );

        assert.match(panel, /developerMode &&/u);
        assert.match(panel, /TOOL_OVERRIDE_OPTIONS/u);
        assert.match(panel, /tool-developer-settings/u);
        assert.match(panel, /Runtime 诊断与保险丝/u);
        assert.match(panel, /Toolset 开关/u);
        assert.match(panel, /工具开关/u);
        assert.match(panel, /Input Schema/u);
        assert.match(panel, /Output Schema/u);
        assert.doesNotMatch(panel, /TOOLSET_OPTIONS/u);
        assert.doesNotMatch(panel, /TOOL_METADATA/u);
      }
    );

    it(
      "gates Developer navigation and Context diagnostics",
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
        const developer = read(
          "../../src/Setting/panels/DeveloperPanel.jsx"
        );

        assert.match(general, /developer-mode/u);
        assert.match(sidebar, /developerOnly/u);
        assert.match(context, /context-developer-settings/u);
        assert.match(context, /共享完整工作区路径/u);
        assert.match(developer, /Prompt Stack/u);
        assert.match(developer, /Effective Prompt/u);
        assert.match(developer, /developer-instructions/u);
      }
    );

    it(
      "renders one activity event stream in the thinking timeline and task panel",
      () => {
        const list = readConversationMessageSource();
        const panel = readConversationTaskPanelSource();
        const activity = read(
          "../../src/Conversation/utils/taskActivity.js"
        );

        assert.match(list, /conversation-thinking-timeline/u);
        assert.match(list, /createActivitySnapshot/u);
        assert.match(activity, /activity\?\.events/u);
        assert.match(panel, /developerMode/u);
        assert.match(panel, /Model output/u);
      }
    );

    it(
      "exposes all Window and Model settings without developer visibility gates",
      () => {
        const names = [
          "AppearancePanel",
          "PetPanel",
          "InputPanel",
          "ResponsePanel",
          "ModelPanel"
        ];
        const panels = names.map((name) => read(
          `../../src/Setting/panels/${name}.jsx`
        ));

        assert.equal(
          panels.every((panel) =>
            !panel.includes('visibility="developer"') &&
            !panel.includes("SettingsVisibility")
          ),
          true
        );
      }
    );
  }
);
