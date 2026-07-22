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
  "compact Input context menu and Session routing",
  () => {
    it(
      "keeps one aligned trigger inside the composer and opens the menu in overlay space",
      () => {
        const input = read(
          "../../src/Input/Input.jsx"
        );
        const composer = read(
          "../../src/Input/components/Composer.jsx"
        );
        const menu = read(
          "../../src/Input/components/ContextMenu.jsx"
        );
        const css = read(
          "../../src/Input/Input.css"
        );
        const resizeHook = read(
          "../../src/Input/hooks/useInputWindowResize.js"
        );
        const inputWindow = read(
          "../../electron/windows/input/inputWindow.js"
        );

        assert.doesNotMatch(menu, /会话上下文/u);
        assert.doesNotMatch(menu, /可选工作区，只读访问/u);
        assert.doesNotMatch(menu, /会话固定绑定工作区/u);
        assert.doesNotMatch(menu, /从资源管理器选择目录/u);
        assert.doesNotMatch(menu, /input-context-menu__scope/u);
        assert.match(menu, /label="模式"/u);
        assert.match(menu, /label="工作区"/u);
        assert.match(menu, /label="会话"/u);
        assert.match(menu, /label="模型"/u);
        assert.match(menu, /label="MCP"/u);

        assert.equal(
          (composer.match(/<InputContextMenu/u) ?? []).length,
          1
        );
        assert.match(
          composer,
          /<div[\s\S]{0,120}className="input-bar"[\s\S]*<InputContextMenu[\s\S]*<textarea/u
        );
        assert.match(menu, /function PlusIcon/u);
        assert.doesNotMatch(menu, />\s*\+\s*</u);
        assert.doesNotMatch(css, /\.input-context-menu\s*\{[^}]*position:\s*absolute/u);
        assert.match(css, /top: calc\(100% \+ 10px\)/u);
        assert.match(css, /max-height: 320px/u);
        assert.match(css, /background: transparent;/u);

        assert.match(input, /menuOpen: overlayOpen/u);
        assert.match(input, /menuHeight: overlayHeight/u);
        assert.match(input, /menuDirection === "up"/u);
        assert.match(resizeHook, /menuExtraHeight:\s*layout\.menuExtraHeight/u);
        assert.doesNotMatch(menu, /estimatePanelHeight/u);
        assert.match(inputWindow, /logicalMenuExtraHeight/u);
        assert.match(inputWindow, /logicalMenuDirection === "up"/u);
        assert.match(inputWindow, /anchor\.y - logicalMenuExtraHeight/u);
        assert.match(inputWindow, /"pop-up-menu"/u);
        assert.match(input, /barRef=\{barRef\}/u);
        assert.match(resizeHook, /getBoundingClientRect/u);
      }
    );

    it(
      "requires an explicit Session selection before a staged mode or workspace becomes active",
      () => {
        const menu = read(
          "../../src/Input/components/ContextMenu.jsx"
        );

        assert.match(menu, /setPage\("workspace"\)/u);
        assert.match(menu, /setPage\("session"\)/u);
        assert.match(menu, /onSelectSession/u);
        assert.match(menu, /onCreateSession/u);
        assert.doesNotMatch(menu, /navigateConversationContext/u);
      }
    );

    it(
      "pins every Input send to the confirmed current Session",
      () => {
        const input = read(
          "../../src/Input/Input.jsx"
        );
        const preload = read(
          "../../electron/preload/preload.cjs"
        );
        const ipc = read(
          "../../electron/ipc/handlers/agentIpc.js"
        );
        const runtime = readAgentRuntimeSource();

        assert.match(input, /expectedConversationId/u);
        assert.match(preload, /expectedConversationId/u);
        assert.match(ipc, /normalizeAgentMessageRequest/u);
        assert.match(runtime, /getConversationTargetError/u);
      }
    );
  }
);
