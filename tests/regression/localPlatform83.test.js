import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("83 exposes a durable background scheduler with controls and budgets", () => {
  const kernel = source("electron/platform/jobs/PlatformLongRunningService.js");
  const scheduler = source("electron/platform/PlatformJobScheduler.js");
  const main = source("electron/main.js");
  assert.match(kernel, /JOB_ENQUEUED/u);
  assert.match(kernel, /JOB_BUDGET_USED/u);
  assert.match(kernel, /recoverInterruptedJobs/u);
  assert.match(scheduler, /pause\(jobId\)/u);
  assert.match(scheduler, /resume\(jobId\)/u);
  assert.match(scheduler, /cancel\(jobId\)/u);
  assert.match(scheduler, /retry\(jobId\)/u);
  assert.match(main, /longRunningAgentService\.start/u);
});

test("83 routes delegated coding work through the background job", () => {
  const delegation = source("electron/platform/delegationTools.js");
  const platform = source("electron/platform/index.js");
  assert.match(delegation, /delegation-workflow/u);
  assert.match(delegation, /platformJobScheduler\.wait/u);
  assert.match(platform, /multiAgentSupervisor\.run/u);
  assert.match(platform, /integrationCoordinator\.integrateAndReview/u);
});

test("83 adds platform commands, detailed developer state and job control IPC", () => {
  const commands = source("src/Input/utils/slashCommand.js");
  const dock = source("src/Conversation/components/PlatformDock.jsx");
  const preload = source("electron/preload/preload.cjs");
  for (const command of ["agents", "tasks", "worktrees", "run", "review", "artifacts"]) {
    assert.match(commands, new RegExp(`id: "${command}"`, "u"));
  }
  assert.match(dock, /controlPlatformJob/u);
  assert.match(dock, /developerMode/u);
  assert.match(dock, /Worktrees \/ Leases/u);
  assert.match(dock, /Artifacts \/ Logs/u);
  assert.match(preload, /onPlatformViewRequested/u);
});

test("Windows worktree text assertions normalize only line endings", () => {
  const integration = source("tests/platform/integrationCoordinator.test.js");
  const worktree = source("tests/platform/worktreeRuntime.test.js");
  assert.match(integration, /replace\(\/\\r\\n\/gu, "\\n"\)/u);
  assert.match(worktree, /replace\(\/\\r\\n\/gu, "\\n"\)/u);
  assert.match(integration, /diff", "--cached"/u);
  assert.match(worktree, /branch", "--show-current"/u);
});
