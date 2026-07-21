import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relativePath) => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("Input exposes bounded manual composition, auto routing and slash invocation", () => {
  const menu = read("src/Input/components/ContextMenu.jsx");
  assert.match(menu, /input-skill-auto/u);
  assert.match(menu, /一个会话最多组合 4 个 Skill/u);
  assert.match(menu, /\/skill-id 任务/u);
  assert.match(menu, /skillRoutingMode: targetRoutingMode/u);
  assert.match(menu, /skillIds: targetSkillIds/u);
});

test("Skill settings expose dependency and router diagnostics", () => {
  const panel = read("src/Setting/panels/SkillsPanel.jsx");
  assert.match(panel, /Skill 依赖/u);
  assert.match(panel, /自动路由关键词/u);
  assert.match(panel, /dependencyState/u);
  assert.match(panel, /keywords/u);
});

test("Agent Runtime preserves advanced Skill selection across run lifecycle", () => {
  const runtime = read("electron/agent/AgentRuntime.js");
  const checkpoint = read("electron/agent/runCheckpoint.js");
  const resume = read("electron/agent/checkpointResume.js");
  assert.match(runtime, /parseSkillCommand/u);
  assert.match(runtime, /previousSkillRun/u);
  assert.match(runtime, /routerSnapshot/u);
  assert.match(checkpoint, /skillSource/u);
  assert.match(checkpoint, /skillRouter/u);
  assert.match(resume, /skillSource/u);
  assert.match(resume, /skillRouter/u);
});
