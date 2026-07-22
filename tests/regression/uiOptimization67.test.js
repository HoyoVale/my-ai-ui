import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  sanitizeSettings
} from "../../electron/settings/validateSettings.js";

import {
  resolveInputOverlayDirection
} from "../../src/Input/utils/inputLayout.js";

import {
  BUILTIN_SLASH_COMMANDS,
  filterSlashCommandSuggestions,
  filterSlashSkillSuggestions,
  findSlashCommand
} from "../../src/Input/utils/slashCommand.js";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Appearance keeps separate Latin and Chinese font choices", () => {
  const settings = sanitizeSettings({
    appearance: {
      latinFontFamily: "georgia",
      chineseFontFamily: "song"
    }
  });
  assert.equal(settings.appearance.latinFontFamily, "georgia");
  assert.equal(settings.appearance.chineseFontFamily, "song");

  const typography = read("../../src/shared/typography.js");
  assert.match(typography, /resolveLatinFontFamily/u);
  assert.match(typography, /resolveChineseFontFamily/u);
});

test("Response anchor accepts negative vertical offsets and Pet exposes tray behavior", () => {
  const settings = sanitizeSettings({
    response: { anchorRatio: -0.64 },
    pet: { showInTray: false }
  });
  assert.equal(settings.response.anchorRatio, -0.64);
  assert.equal(settings.pet.showInTray, false);

  const tray = read("../../electron/windows/tray/trayManager.js");
  assert.match(tray, /new Tray/u);
  assert.match(tray, /输入消息/u);
  assert.match(tray, /resolveAssistantDisplayName/u);
  assert.match(tray, /退出 \$\{assistantName\}/u);
});

test("Input overlays choose the side with usable screen space", () => {
  assert.equal(resolveInputOverlayDirection({
    windowTop: 900,
    baseHeight: 52,
    overlayHeight: 300,
    screenTop: 0,
    screenHeight: 1080
  }), "up");

  assert.equal(resolveInputOverlayDirection({
    windowTop: 80,
    baseHeight: 52,
    overlayHeight: 300,
    screenTop: 0,
    screenHeight: 1080
  }), "down");
});

test("slash command detection works at the active token only", () => {
  assert.deepEqual(findSlashCommand("/deb", 4), {
    start: 0,
    end: 4,
    query: "deb"
  });
  assert.deepEqual(findSlashCommand("请运行 /review", 11), {
    start: 4,
    end: 11,
    query: "review"
  });
  assert.equal(findSlashCommand("https://example.com/", 20), null);
});



test("slash Skill suggestions normalize modes and hide unavailable entries", () => {
  const skills = [
    { id: "debug", name: "Debug", modes: ["Coding"], enabled: true, available: true, integrity: "verified", keywords: ["报错"] },
    { id: "review", name: "Review", modes: ["chat"], enabled: false, available: true, integrity: "verified" },
    { id: "broken", name: "Broken", modes: ["coding"], enabled: true, available: false, integrity: "changed" }
  ];

  assert.deepEqual(
    filterSlashSkillSuggestions(skills, { mode: "coding", query: "报错" }).map((skill) => skill.id),
    ["debug"]
  );
  assert.deepEqual(
    filterSlashSkillSuggestions(skills, { mode: "chat" }),
    []
  );
});

test("slash command registry combines real app commands and compatible Skills", () => {
  assert.equal(BUILTIN_SLASH_COMMANDS.some((command) => command.id === "goal"), true);
  assert.equal(BUILTIN_SLASH_COMMANDS.some((command) => command.id === "model"), true);
  const suggestions = filterSlashCommandSuggestions({
    mode: "coding",
    query: "goal",
    skills: [{ id: "goal-review", name: "Goal Review", description: "Review", modes: ["coding"], enabled: true, available: true, integrity: "verified" }]
  });
  assert.deepEqual(suggestions.slice(0, 2).map((item) => `${item.kind}:${item.id}`), [
    "command:goal",
    "skill:goal-review"
  ]);
});

test("Conversation creates sessions from workspace groups and clamps long titles", () => {
  const sidebar = read("../../src/Conversation/components/Sidebar.jsx");
  const topbar = read("../../src/Conversation/components/Topbar.jsx");
  const css = read("../../src/Conversation/Conversation.css");

  assert.match(sidebar, /conversation-workspace-group__create/u);
  assert.match(sidebar, /onCreate\?\.\(\{/u);
  assert.doesNotMatch(topbar, /data-testid="conversation-new"/u);
  assert.match(css, /text-overflow:\s*ellipsis/u);
  assert.match(css, /overflow-x:\s*hidden/u);
});

test("obsolete Recovery Center UI is removed and file diffs are visible", () => {
  const conversation = read("../../src/Conversation/Conversation.jsx");
  const taskPanel = read("../../src/Conversation/components/TaskPanel.jsx");
  const messageList = read("../../src/Conversation/components/MessageList.jsx");

  assert.doesNotMatch(conversation, /ConversationRecoveryPanel/u);
  assert.match(taskPanel, /FileDiffPreview/u);
  assert.match(messageList, /FinalDiffSummary/u);
  assert.match(messageList, /ToolCommandPreview/u);
});

test("Response only enables the vertical scrollbar after overflow is measured", () => {
  const hook = read("../../src/Response/hooks/useResponseLayout.js");
  const bubble = read("../../src/Response/components/Bubble.jsx");
  const css = read("../../src/Response/Response.css");

  assert.match(hook, /scrollHeight > content\.clientHeight \+ 1/u);
  assert.match(bubble, /is-scrollable/u);
  assert.match(css, /\.response-bubble__content\.is-scrollable/u);
});
