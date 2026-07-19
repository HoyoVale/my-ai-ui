import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(
  path.resolve(here, relativePath),
  "utf8"
);

describe("Tool Runtime boundary fallback contract", () => {
  it("keeps quota, repeat and activity policies in the Tool manifest", () => {
    const registry = read("../../electron/tools/core/ToolRegistry.js");
    const executor = read("../../electron/tools/core/ToolExecutor.js");

    assert.match(registry, /countsTowardRepeatLimit/u);
    assert.match(registry, /activityVisibility/u);
    assert.match(executor, /gracefulBoundary/u);
    assert.match(executor, /"budget_exceeded"/u);
  });

  it("hides developer-only tools from the normal timeline", () => {
    const messageList = read("../../src/Conversation/components/MessageList.jsx");
    const taskPanel = read("../../src/Conversation/components/TaskPanel.jsx");

    assert.match(messageList, /isActivityEventVisible/u);
    assert.match(taskPanel, /isActivityEventVisible/u);
  });

  it("uses deterministic progress handoff when model finalization is unavailable", () => {
    const runtime = read("../../electron/agent/AgentRuntime.js");
    const finalization = read("../../electron/agent/finalization.js");

    assert.match(runtime, /createFallbackFinalSummary/u);
    assert.match(runtime, /最终总结第 \$\{attempt\} 次尝试失败/u);
    assert.match(runtime, /MODEL_RECOVERY/u);
    assert.match(finalization, /natural progress handoff/u);
  });
});
