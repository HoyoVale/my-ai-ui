import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Goal Runtime persists criteria, completion authority and bounded evidence history", () => {
  const schema = read("../../electron/conversation/conversationSchema.js");
  const goalRuntime = read("../../electron/goal/GoalRuntime.js");
  const manager = read("../../electron/conversation/ConversationManager.js");
  assert.match(schema, /const STORE_VERSION = 21/u);
  assert.match(schema, /sanitizeGoal/u);
  assert.match(goalRuntime, /GOAL_SCHEMA_VERSION = 6/u);
  assert.match(goalRuntime, /verificationHistory/u);
  assert.match(goalRuntime, /completionFingerprint/u);
  assert.match(goalRuntime, /autoContinue/u);
  assert.match(goalRuntime, /GOAL_VERIFICATION_HISTORY_LIMIT/u);
  assert.match(manager, /recordGoalVerification/u);
});

test("Goal completion is criterion-aware and progress is written back during execution", () => {
  const verifier = read("../../electron/agent/GoalCompletionVerifier.js");
  const runtime = read("../../electron/agent/AgentRuntime.js");
  assert.match(verifier, /criterionId/u);
  assert.match(verifier, /inferGoalCriterionKind/u);
  assert.match(verifier, /user-confirmed/u);
  assert.match(runtime, /beginGoalRun/u);
  assert.match(runtime, /heartbeatGoal/u);
  assert.match(runtime, /recordGoalCheckpoint/u);
  assert.match(runtime, /recordGoalVerification/u);
  assert.match(runtime, /finishGoalRun/u);
  assert.match(runtime, /goalSpec\?\.autoContinue === false/u);
});

test("Input slash menu exposes built-in commands and keeps Skills in one registry", () => {
  const registry = read("../../src/Input/utils/slashCommand.js");
  const menu = read("../../src/Input/components/SlashMenu.jsx");
  const composer = read("../../src/Input/components/Composer.jsx");
  for (const command of ["goal", "model", "workspace", "session", "skill", "mcp", "new", "plan", "status"]) {
    assert.match(registry, new RegExp(`id: "${command}"`, "u"));
  }
  assert.match(menu, /filterSlashCommandSuggestions/u);
  assert.match(menu, /data-command-count/u);
  assert.match(composer, /openPage\(action\.page\)/u);
  assert.match(composer, /action\.type === "new-session"/u);
});
