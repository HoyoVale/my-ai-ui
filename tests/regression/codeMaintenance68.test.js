import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  resolveFontFamily
} from "../../src/shared/typography.js";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("font settings use free-form inputs and keep the CJK stack before the generic fallback", () => {
  const panel = read("../../src/Setting/panels/AppearancePanel.jsx");
  assert.match(panel, /placeholder="留空使用系统当前字体"/u);
  assert.match(panel, /placeholder="留空使用系统当前中文字体"/u);
  assert.doesNotMatch(panel, /LATIN_FONT_OPTIONS/u);
  assert.doesNotMatch(panel, /CHINESE_FONT_OPTIONS/u);

  const stack = resolveFontFamily({
    latinFontFamily: "custom",
    customLatinFontFamily: "Inter",
    chineseFontFamily: "custom",
    customChineseFontFamily: "Microsoft YaHei UI"
  });
  assert.ok(stack.indexOf("Inter") < stack.indexOf("Microsoft YaHei UI"));
  assert.ok(stack.indexOf("Microsoft YaHei UI") < stack.lastIndexOf("sans-serif"));
});

test("slash menu remains visible without Skills and deduplicates measured heights", () => {
  const input = read("../../src/Input/Input.jsx");
  const menu = read("../../src/Input/components/SlashMenu.jsx");
  const contextMenu = read("../../src/Input/components/ContextMenu.jsx");
  const context = read("../../src/Input/hooks/useInputContext.js");

  assert.match(menu, /const open = Boolean\(command && !disabled && !suppressed\)/u);
  assert.match(menu, /正在读取命令与 Skills/u);
  assert.match(menu, /没有匹配的命令或 Skill/u);
  assert.match(menu, /data-command-count/u);
  assert.match(context, /getSkillRuntimeState\?\.\(mode\)/u);
  assert.match(context, /skillsReady/u);

  assert.match(input, /handleSlashMenuPanelHeightChange/u);
  assert.match(input, /current === nextHeight \? current : nextHeight/u);
  assert.doesNotMatch(
    input,
    /onSlashMenuPanelHeightChange=\{\(height\) =>/u
  );
  assert.match(menu, /lastPanelHeightRef/u);
  assert.match(contextMenu, /lastPanelHeightRef/u);
  assert.match(contextMenu, /consumedCloseTokenRef/u);
  assert.doesNotMatch(contextMenu, /closeToken > 0 && open/u);
  assert.doesNotMatch(
    input,
    /setContextMenuHeight[\s\S]{0,120}setSlashSuppressed\(false\)/u
  );
});

test("retired recovery UI is reduced to a compatibility shim and renderer routes are split lazily", () => {
  const recoveryShim = read("../../src/Conversation/components/RecoveryPanel.jsx");
  assert.match(recoveryShim, /return null/u);
  assert.doesNotMatch(recoveryShim, /恢复中心|待处理操作|recovery-item/u);

  const conversationHook = read("../../src/Conversation/hooks/useWindowMaximized.js");
  const settingHook = read("../../src/Setting/hooks/useWindowMaximized.js");
  assert.match(conversationHook, /shared\/hooks\/useWindowMaximized/u);
  assert.match(settingHook, /shared\/hooks\/useWindowMaximized/u);

  const app = read("../../src/App.jsx");
  assert.match(app, /lazy\(\(\) => import/u);
  assert.match(app, /Suspense/u);
});
