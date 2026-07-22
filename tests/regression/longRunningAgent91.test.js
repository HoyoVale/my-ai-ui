import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("91 provides the full durable Long-running Agent state machine", () => {
  const kernel = source("electron/platform/PlatformKernel.js");
  const scheduler = source("electron/platform/PlatformJobScheduler.js");
  for (const state of [
    "scheduled",
    "waiting_input",
    "waiting_approval",
    "waiting_external",
    "retry_scheduled"
  ]) {
    assert.match(kernel, new RegExp(`"${state}"`, "u"));
  }
  assert.match(kernel, /recordJobCheckpoint/u);
  assert.match(kernel, /recordJobReceipt/u);
  assert.match(kernel, /requestJobApproval/u);
  assert.match(kernel, /promoteDueJobs/u);
  assert.match(scheduler, /long-running-job:/u);
  assert.match(scheduler, /retryDelay/u);
  assert.match(scheduler, /waitForInput/u);
  assert.match(scheduler, /requestApproval/u);
});

test("91 connects Electron power, network and native notification lifecycle", () => {
  const adapter = source("electron/platform/ElectronLongRunningAdapter.js");
  const service = source("electron/platform/LongRunningAgentService.js");
  const main = source("electron/main.js");
  assert.match(adapter, /powerMonitor\.on\("suspend"/u);
  assert.match(adapter, /powerMonitor\.on\("resume"/u);
  assert.match(adapter, /net\.isOnline/u);
  assert.match(adapter, /Notification\.isSupported/u);
  assert.match(service, /pruneLongRunningState/u);
  assert.match(main, /longRunningAgentService\.start/u);
  assert.match(main, /longRunningAgentService\.stop/u);
});

test("91 exposes Approval Inbox, input continuation and notification controls", () => {
  const dock = source("src/Conversation/components/PlatformDock.jsx");
  const ipc = source("electron/ipc/handlers/platformIpc.js");
  const preload = source("electron/preload/preload.cjs");
  assert.match(dock, /Approval Inbox/u);
  assert.match(dock, /通知中心/u);
  assert.match(dock, /providePlatformJobInput/u);
  assert.match(dock, /resolvePlatformApproval/u);
  assert.match(ipc, /RESOLVE_APPROVAL/u);
  assert.match(ipc, /PROVIDE_INPUT/u);
  assert.match(preload, /controlPlatformNotification/u);
});

test("91 adds a real child-process crash recovery test to CI", () => {
  const packageJson = JSON.parse(source("package.json"));
  const ci = source(".github/workflows/ci.yml");
  const e2e = source("tests/e2e/long-running-agent-crash-recovery.mjs");
  assert.match(packageJson.scripts["test:e2e:long-running-crash"], /long-running-agent-crash-recovery/u);
  assert.match(ci, /test:e2e:long-running-crash/u);
  assert.match(e2e, /repeatedSideEffects/u);
  assert.match(e2e, /receipts\.length/u);
});
