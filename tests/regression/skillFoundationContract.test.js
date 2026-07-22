import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

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

test("Skill Runtime keeps staged selection and stale UI state consistent", () => {
  const menu = read("src/Input/components/ContextMenu.jsx");
  const inputHook = read("src/Input/hooks/useInputContext.js");
  const settingsHook = read("src/Setting/hooks/useSkills.js");
  const panel = read("src/Setting/panels/SkillsPanel.jsx");

  assert.match(menu, /targetSkillId/u);
  assert.match(menu, /skillId: targetSkillId/u);
  assert.match(menu, /boundSkillUnavailable/u);
  assert.match(menu, /boundSkillChanged/u);
  assert.match(menu, /runtimeFingerprint/u);
  assert.match(menu, /该 Skill 不支持当前目标模式/u);
  assert.match(inputHook, /refreshSequence/u);
  assert.match(settingsHook, /requestSequence/u);
  assert.match(panel, /setReports\(\{\}\)/u);
  assert.match(panel, /!skill\.enabled && skill\.integrity !== "verified"/u);
});

test("Skill Runtime binds continuation and recovery to immutable Skill snapshots", () => {
  const runtime = readAgentRuntimeSource();
  const skillRuntime = read("electron/skills/SkillRuntime.js");
  const schema = read("electron/conversation/conversationSchema.js");

  assert.match(runtime, /preparedExecution\.conversation\.skillId/u);
  assert.match(runtime, /expectedSnapshot: preparedExecution\.conversation\.skillSnapshot/u);
  assert.match(runtime, /expectedSnapshot: plan\.conversation\.skillSnapshot/u);
  assert.match(runtime, /expectedSnapshot: execution\.conversation\.skillSnapshot/u);
  assert.match(skillRuntime, /skill-snapshot-mismatch/u);
  assert.match(schema, /createSkillSnapshot/u);
});
