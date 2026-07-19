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
        assert.doesNotMatch(panel, /展示层级|活动显示/u);
        assert.doesNotMatch(panel, /tool-display-detail/u);
        assert.doesNotMatch(
          panel,
          /启用工具调用|当前模型|固定安全边界/u
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
      "renders one activity event stream in the thinking timeline and task panel",
      () => {
        const list = read(
          "../../src/Conversation/components/MessageList.jsx"
        );
        const panel = read(
          "../../src/Conversation/components/TaskPanel.jsx"
        );
        const activity = read(
          "../../src/Conversation/utils/taskActivity.js"
        );

        assert.match(
          list,
          /conversation-thinking-timeline/u
        );
        assert.match(
          list,
          /createActivitySnapshot/u
        );
        assert.match(
          activity,
          /activity\?\.events/u
        );
        assert.match(
          panel,
          /developerMode/u
        );
        assert.match(
          panel,
          /Model output/u
        );
      }
    );

    it(
      "uses one normal/developer visibility control across existing setting tabs",
      () => {
        const controls = read(
          "../../src/Setting/components/Controls.jsx"
        );
        const content = read(
          "../../src/Setting/components/Content.jsx"
        );
        const panels = [
          "AppearancePanel",
          "PetPanel",
          "InputPanel",
          "ResponsePanel",
          "PersonalityPanel",
          "MemoryPanel",
          "ModelPanel"
        ].map((name) => read(
          `../../src/Setting/panels/${name}.jsx`
        ));

        assert.match(controls, /function SettingsVisibility/u);
        assert.match(controls, /visibility === "developer"/u);
        assert.match(content, /<PetPanel[\s\S]*developerMode=/u);
        assert.match(content, /<ResponsePanel[\s\S]*developerMode=/u);
        assert.equal(
          panels.every((panel) =>
            panel.includes("visibility=\"developer\"")
          ),
          true
        );
      }
    );
  }
);
