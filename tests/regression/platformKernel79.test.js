import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  readAgentRuntimeSource
} from "../helpers/agentRuntimeSource.js";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Core Lite keeps Platform source dormant and out of startup recovery", () => {
  const runtime = readAgentRuntimeSource();
  const main = read("../../electron/main.js");
  const registration = read("../../electron/ipc/registerIpcHandlers.js");

  assert.doesNotMatch(runtime, /platformKernel|platform\/(?:index|coreLitePlatform)/u);
  assert.doesNotMatch(main, /platformKernel|longRunningAgentService/u);
  assert.doesNotMatch(registration, /registerPlatformIpc/u);
});

test("Platform IPC remains only as an unregistered compatibility surface", () => {
  const channels = read("../../electron/shared/ipcChannels.cjs");
  const preload = read("../../electron/preload/preload.cjs");
  const handler = read("../../electron/ipc/handlers/platformIpc.js");
  const registration = read("../../electron/ipc/registerIpcHandlers.js");
  assert.match(channels, /platform-get-state/u);
  assert.match(preload, /getPlatformState/u);
  assert.match(handler, /requireConversationSender/u);
  assert.doesNotMatch(registration, /registerPlatformIpc/u);
});
