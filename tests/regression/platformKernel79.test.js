import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Platform Kernel is wired into Goal execution and startup recovery", () => {
  const runtime = readAgentRuntimeSource();
  const main = read("../../electron/main.js");
  const manager = read("../../electron/conversation/ConversationManager.js");
  assert.match(runtime, /platformKernel\.prepareExecution/u);
  assert.match(runtime, /platformKernel\.authorizeCompletion/u);
  assert.match(main, /platformKernel\.recoverInterruptedRuns/u);
  assert.match(manager, /completionAuthority\.verify/u);
  assert.match(manager, /linkGoalPlatformRun/u);
});

test("Platform state is exposed through read-only Conversation IPC", () => {
  const channels = read("../../electron/shared/ipcChannels.cjs");
  const preload = read("../../electron/preload/preload.cjs");
  const handler = read("../../electron/ipc/handlers/platformIpc.js");
  assert.match(channels, /platform-get-state/u);
  assert.match(preload, /getPlatformState/u);
  assert.match(handler, /requireConversationSender/u);
});
