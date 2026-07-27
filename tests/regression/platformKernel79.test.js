import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readAgentRuntimeSource } from "../helpers/agentRuntimeSource.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Core Lite keeps Platform source dormant and out of startup recovery", () => {
  const runtime = readAgentRuntimeSource();
  const main = read("electron/main.js");
  const registration = read("electron/ipc/registerIpcHandlers.js");

  assert.doesNotMatch(runtime, /platformKernel|platform\/(?:index|coreLitePlatform)/u);
  assert.doesNotMatch(main, /platformKernel|longRunningAgentService/u);
  assert.doesNotMatch(registration, /registerPlatformIpc/u);
});

test("Core Lite exposes no Platform IPC or preload compatibility surface", () => {
  const channels = read("electron/shared/ipcChannels.cjs");
  const preload = read("electron/preload/preload.cjs");

  assert.equal(fs.existsSync(path.join(root, "electron/ipc/handlers/platformIpc.js")), false);
  assert.doesNotMatch(channels, /platform-get-state|platform-control-job|platform-changed/u);
  assert.doesNotMatch(preload, /getPlatformState|controlPlatformJob|onPlatformChanged|onPlatformViewRequested/u);
});
