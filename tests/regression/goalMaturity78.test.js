import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Goal Runtime persists criteria, completion authority and bounded evidence history", () => {
  const schema = read("../../electron/conversation/conversationSchema.js");
  const goalRuntime = read("../../electron/goal/GoalRuntime.js");
  const manager = read("../../electron/conversation/services/ConversationExecutionService.js");
  assert.match(schema, /const STORE_VERSION = 23/u);
  assert.match(schema, /sanitizeGoal/u);
  assert.match(goalRuntime, /GOAL_SCHEMA_VERSION = 6/u);
  assert.match(goalRuntime, /verificationHistory/u);
  assert.match(goalRuntime, /completionFingerprint/u);
  assert.match(goalRuntime, /autoContinue/u);
  assert.match(goalRuntime, /GOAL_VERIFICATION_HISTORY_LIMIT/u);
  assert.match(manager, /recordGoalVerification/u);
});

test("Core Lite keeps Goal verification source dormant outside Agent execution", () => {
  const verifier = read("../../electron/agent/GoalCompletionVerifier.js");
  const runtime = readAgentRuntimeSource();
  assert.match(verifier, /criterionId/u);
  assert.match(verifier, /inferGoalCriterionKind/u);
  assert.match(verifier, /user-confirmed/u);
  assert.doesNotMatch(runtime, /beginGoalRun|recordGoalWorkingState/u);
  assert.doesNotMatch(runtime, /platformKernel|authorizeCompletion/u);
});

test("Core Lite slash menu keeps foundational commands in one registry", () => {
  const registry = read("../../src/Input/utils/slashCommand.js");
  const menu = read("../../src/Input/components/SlashMenu.jsx");
  const composer = read("../../src/Input/components/Composer.jsx");
  for (const command of ["model", "workspace", "session", "skill", "mcp", "new", "status", "memory", "settings"]) {
    assert.match(registry, new RegExp(`id: "${command}"`, "u"));
  }
  for (const command of ["goal", "plan", "agents", "tasks", "worktrees", "review", "artifacts"]) {
    assert.doesNotMatch(registry, new RegExp(`id: "${command}"`, "u"));
  }
  assert.match(menu, /filterSlashCommandSuggestions/u);
  assert.match(menu, /data-command-count/u);
  assert.match(composer, /openPage\(action\.page\)/u);
  assert.match(composer, /action\.type === "new-session"/u);
});
