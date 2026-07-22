import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

function read(relativePath) {
  return fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("94 persists Token Ledger usage across Agent, Conversation and Goal boundaries", () => {
  const runtime = readAgentRuntimeSource();
  const schema = read("electron/conversation/conversationSchema.js");
  const goal = read("electron/goal/GoalRuntime.js");
  const inspector = read("src/Conversation/components/ContextInspector.jsx");

  assert.match(runtime, /new TokenLedger\(/u);
  assert.match(runtime, /recordProviderUsage\(/u);
  assert.match(runtime, /recordTool\(record\)/u);
  assert.match(runtime, /setToolDefinitions\(toolSession\.definitions\)/u);
  assert.match(schema, /const STORE_VERSION = 22/u);
  assert.match(schema, /sanitizeTokenLedgerSnapshot/u);
  assert.match(goal, /const GOAL_SCHEMA_VERSION = 6/u);
  assert.match(goal, /recordGoalTokenUsage/u);
  assert.match(inspector, /data-testid="token-ledger-summary"/u);
  assert.match(inspector, /工具返回（估算）/u);
});

test("94 routes ToolExecutor calls through the resource-aware Tool Scheduler", () => {
  const executor = read("electron/tools/core/ToolExecutor.js");
  const scheduler = read("electron/tools/core/ToolScheduler.js");
  const guard = read("electron/tools/core/ToolConcurrencyGuard.js");

  assert.match(executor, /new ToolScheduler\(/u);
  assert.match(executor, /this\.scheduler\.acquire\(/u);
  assert.match(scheduler, /workspace-scope|workspace:/u);
  assert.match(scheduler, /PLAN_TOOLS/u);
  assert.match(scheduler, /exclusiveConcurrency/u);
  assert.match(guard, /workspaceKeysOverlap/u);
  assert.match(guard, /queuedBarriers/u);
});
