import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AgentRunSession } from "../../electron/agent/AgentRunSession.js";
import { sanitizeSettings } from "../../electron/settings/validateSettings.js";
import { verifyCoreLiteTree } from "../../scripts/verify-core-lite-tree.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Core Lite source tree contains no retired advanced runtime", () => {
  assert.deepEqual(verifyCoreLiteTree(), { ok: true, errors: [] });
  for (const relativePath of [
    "electron/goal",
    "electron/execution-model",
    "electron/platform",
    "electron/agent/RunEngine.js",
    "electron/agent/ExecutionThread.js",
    "electron/agent/PlanAuthority.js",
    "electron/agent/orchestration"
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  }
});

test("Core Lite exposes one Run Session and Run Unit lifecycle", () => {
  const session = new AgentRunSession({
    runId: "run-1",
    taskId: "task-1",
    conversationId: "conversation-1",
    abortController: new AbortController()
  });
  assert.equal(session.currentRunUnitId, "run:run-1");
  assert.equal(Object.hasOwn(session, "currentSegmentId"), false);

  const execution = read("electron/agent/execution/AgentRunExecution.js");
  assert.match(execution, /RUN_UNIT_STARTED/u);
  assert.match(execution, /RUN_UNIT_COMMITTED/u);
  assert.doesNotMatch(execution, /SEGMENT_STARTED|SEGMENT_COMMITTED/u);
});

test("Core Lite settings contain only active run limits", () => {
  const settings = sanitizeSettings({
    tools: {
      runtime: {
        maxSteps: 12,
        maxSegments: 99,
        maxNoProgressSegments: 9
      }
    }
  });
  assert.equal(settings.tools.runtime.maxSteps, 12);
  assert.equal(Object.hasOwn(settings.tools.runtime, "maxSegments"), false);
  assert.equal(Object.hasOwn(settings.tools.runtime, "maxNoProgressSegments"), false);
});

test("Core Lite keeps Platform and advanced IPC absent while retaining process supervision", () => {
  const channels = read("electron/shared/ipcChannels.cjs");
  const preload = read("electron/preload/preload.cjs");
  assert.doesNotMatch(channels, /platform-get-state|platform-changed/u);
  assert.doesNotMatch(preload, /getPlatformState|controlPlatformJob/u);
  assert.equal(
    fs.existsSync(path.join(root, "electron/tools/process/SubprocessSupervisor.js")),
    true
  );
});
