import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Goal v3 persists criteria, completion authority and bounded evidence history", () => {
  const schema = read("../../electron/conversation/conversationSchema.js");
  const manager = read("../../electron/conversation/ConversationManager.js");
  assert.match(schema, /const STORE_VERSION = 19/u);
  assert.match(schema, /verificationHistory/u);
  assert.match(schema, /completionFingerprint/u);
  assert.match(schema, /autoContinue/u);
  assert.match(manager, /recordGoalVerification/u);
  assert.match(manager, /slice\(-12\)/u);
});

test("Goal completion is criterion-aware and progress is written back during execution", () => {
  const verifier = read("../../electron/agent/GoalCompletionVerifier.js");
  const runtime = read("../../electron/agent/AgentRuntime.js");
  assert.match(verifier, /criterionId/u);
  assert.match(verifier, /inferGoalCriterionKind/u);
  assert.match(verifier, /user-confirmed/u);
  assert.match(runtime, /recordGoalVerification/u);
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
