import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyCoreLiteTree } from "../../scripts/verify-core-lite-tree.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Core Lite 3.6 P0 physically removes retired Goal Plan and Platform panels", () => {
  for (const file of [
    "src/Conversation/components/GoalPanel.jsx",
    "src/Conversation/components/PlanDock.jsx",
    "src/Conversation/components/PlatformDock.jsx",
    "src/Conversation/styles/plan-goal.css",
    "src/Conversation/styles/platform.css"
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
  assert.doesNotMatch(read("src/Conversation/styles/responsive.css"), /conversation-platform-dock/u);
});

test("Core Lite 3.6 P0 removes Platform IPC channels handlers and preload methods", () => {
  const channels = read("electron/shared/ipcChannels.cjs");
  const preload = read("electron/preload/preload.cjs");
  assert.equal(fs.existsSync(path.join(root, "electron/ipc/handlers/platformIpc.js")), false);
  assert.doesNotMatch(channels, /platform-get-state|platform-control-job|platform-changed/u);
  assert.doesNotMatch(preload, /getPlatformState|controlPlatformJob|onPlatformChanged|onPlatformViewRequested/u);
});

test("Core Lite 3.6 P0 tree verifier locks the removed UI and API boundary", () => {
  assert.deepEqual(verifyCoreLiteTree(), { ok: true, errors: [] });
});
