import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relativePath) => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("Setting exposes Skill Foundation management UI", () => {
  const tabs = read("src/Setting/constants/Tabs.js");
  const content = read("src/Setting/components/Content.jsx");
  const panel = read("src/Setting/panels/SkillsPanel.jsx");
  assert.match(tabs, /id: "skills"/u);
  assert.match(content, /<SkillsPanel/u);
  assert.match(panel, /skill-import-directory/u);
  assert.match(panel, /skill-import-zip/u);
  assert.match(panel, /setSkillEnabled/u);
  assert.match(panel, /uninstallSkill/u);
});

test("Skill IPC is isolated to Setting and supports lifecycle operations", () => {
  const handler = read("electron/ipc/handlers/skillIpc.js");
  const channels = read("electron/shared/ipcChannels.cjs");
  const preload = read("electron/preload/preload.cjs");
  assert.match(handler, /Only the Setting window can manage Skills/u);
  assert.match(channels, /skills-import-directory/u);
  assert.match(channels, /skills-import-zip/u);
  assert.match(channels, /skills-set-enabled/u);
  assert.match(channels, /skills-uninstall/u);
  assert.match(preload, /importSkillDirectory/u);
  assert.match(preload, /importSkillZip/u);
});
