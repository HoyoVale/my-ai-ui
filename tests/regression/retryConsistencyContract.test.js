import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(file) {
  return fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
}

test("Core Lite owns Provider retries instead of delegating them invisibly to the SDK", () => {
  const execution = read("electron/agent/execution/AgentRunExecution.js");
  const finalization = read("electron/agent/finalization/AgentRunFinalization.js");
  const providerOptions = read("electron/agent/providers/sdkProviderRegistry.js");

  assert.match(execution, /resolveProviderRetry/u);
  assert.match(execution, /maxRetries:\s*0/u);
  assert.match(execution, /publicOutputStarted/u);
  assert.match(execution, /toolActivityStarted/u);
  assert.match(finalization, /allowAfterOutput:\s*true/u);
  assert.match(finalization, /maxRetries:\s*0/u);
  assert.doesNotMatch(providerOptions, /maxRetries:\s*modelSettings\.maxRetries/u);
});

test("Provider and Tool retries share explicit cancellation and backoff boundaries", () => {
  const providerPolicy = read("electron/agent/ProviderRetryPolicy.js");
  const toolErrors = read("electron/tools/core/toolErrors.js");
  const toolExecutor = read("electron/tools/core/ToolExecutor.js");

  assert.match(providerPolicy, /public-output-started/u);
  assert.match(providerPolicy, /tool-activity-started/u);
  assert.match(providerPolicy, /retryAfterMs/u);
  assert.doesNotMatch(toolErrors, /value\?\.name\s*===\s*"AbortError"/u);
  assert.match(toolErrors, /RATE_LIMITED/u);
  assert.match(toolExecutor, /toolRetryDelayMs/u);
});

test("closed Skill renderers are treated as an expected subscriber disconnect", () => {
  const notification = read("electron/skills/SkillNotification.js");
  const registry = read("electron/skills/SkillRegistry.js");

  assert.match(notification, /renderer closed/u);
  assert.match(notification, /ignored:\s*true/u);
  assert.match(registry, /onNotifyError/u);
  assert.doesNotMatch(registry, /console\.warn\("广播 Skill 状态失败/u);
});
