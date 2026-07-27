import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

const FORBIDDEN_PATHS = Object.freeze([
  "electron/goal",
  "electron/execution-model",
  "electron/agent/ExecutionThread.js",
  "electron/agent/GoalCompletionVerifier.js",
  "electron/agent/PlanAuthority.js",
  "electron/agent/RunEngine.js",
  "electron/agent/checkpointResume.js",
  "electron/agent/orchestration",
  "electron/agent/planState.js",
  "electron/agent/runCheckpoint.js",
  "electron/config/coreLite.js",
  "electron/conversation/services/ConversationExecutionService.js",
  "electron/platform",
  "src/Conversation/components/GoalPanel.jsx",
  "src/Conversation/components/PlanDock.jsx",
  "src/Conversation/components/PlatformDock.jsx",
  "src/Conversation/styles/plan-goal.css",
  "src/Conversation/styles/platform.css",
  "electron/ipc/handlers/platformIpc.js",

  "tests/platform",
  "tests/e2e/platform-kernel-crash-recovery.mjs",
  "tests/e2e/worktree-runtime-crash-recovery.mjs",
  "tests/e2e/multi-agent-supervisor-crash-recovery.mjs",
  "tests/e2e/long-running-agent-crash-recovery.mjs",
  "tests/fixtures/long-running-agent-crash-worker.mjs",
  "tests/regression/localPlatform83.test.js",
  "tests/regression/longRunningAgent91.test.js",
  "tests/regression/verificationLoop84.test.js",
  "tests/regression/worktreeMultiAgent81.test.js",
  "src/shared/runtimeDefaults.js",
  "docs/PLATFORM_KERNEL_AND_MULTI_AGENT_PLAN.md",
  "docs/LOCAL_PLATFORM_83.md",
  "docs/LONG_RUNNING_AGENT_91.md",
  "docs/MULTI_AGENT_SUPERVISOR_90.md",
  "docs/WORKTREE_MULTI_AGENT_80_81.md",
  "docs/INTEGRATION_REVIEW_82.md",
  "docs/VERIFICATION_LOOP_84.md",
  "docs/CORE_RUNTIME_REFACTOR_PHASE3_100.md",
  "tests/goal",
  "tests/execution-model",
  "tests/e2e/goal-runtime-crash-recovery.mjs",
  "tests/fixtures/goal-runtime-crash-worker.mjs",
  "temp.log",
  "test-results",
  "playwright-report"
]);

const FORBIDDEN_TEST_TOKENS = Object.freeze([
  "input-slash-command-goal",
  "input-goal-criteria"
]);

const SCAN_FILES = Object.freeze([
  "tests/e2e/conversation-flow.cjs",
  "package.json"
]);

const FORBIDDEN_PLATFORM_SURFACE_TOKENS = Object.freeze([
  "platform-get-state",
  "platform-control-job",
  "platform-changed",
  "getPlatformState",
  "getPlatformRun",
  "controlPlatformJob",
  "resolvePlatformApproval",
  "providePlatformJobInput",
  "signalPlatformExternal",
  "controlPlatformNotification",
  "onPlatformChanged",
  "onPlatformViewRequested"
]);

const PLATFORM_SURFACE_FILES = Object.freeze([
  "electron/shared/ipcChannels.cjs",
  "electron/preload/preload.cjs"
]);

const RETIRED_PLATFORM_TOKENS = Object.freeze([
  "PlatformKernel",
  "MultiAgentSupervisor",
  "LongRunningAgentService",
  "IntegrationCoordinator",
  "IndependentTaskEvaluator",
  "IndependentReplanner",
  "WorktreeRuntime",
  "PlatformJobScheduler",
  "resolveWorkerModelSettings",
  "WORKER_RUNTIME_DEFAULTS",
  "WORKER_RUNTIME_LIMITS"
]);

const RETIRED_PLATFORM_SCAN_FILES = Object.freeze([
  "package.json",
  ".github/workflows/ci.yml",
  "src/shared/defaultSettings.js",
  "electron/settings/validateSettings.js",
  "electron/settings/modelSettings.js"
]);

function exists(relativePath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

export function verifyCoreLiteTree() {
  const errors = [];

  for (const relativePath of FORBIDDEN_PATHS) {
    if (exists(relativePath)) {
      errors.push(`forbidden path exists: ${relativePath}`);
    }
  }

  for (const relativePath of SCAN_FILES) {
    if (!exists(relativePath)) {
      errors.push(`required verification target is missing: ${relativePath}`);
      continue;
    }
    const text = read(relativePath);
    for (const token of FORBIDDEN_TEST_TOKENS) {
      if (text.includes(token)) {
        errors.push(`${relativePath} still references retired selector: ${token}`);
      }
    }
  }

  for (const relativePath of PLATFORM_SURFACE_FILES) {
    if (!exists(relativePath)) {
      errors.push(`required Platform surface target is missing: ${relativePath}`);
      continue;
    }
    const text = read(relativePath);
    for (const token of FORBIDDEN_PLATFORM_SURFACE_TOKENS) {
      if (text.includes(token)) {
        errors.push(`${relativePath} still exposes retired Platform surface: ${token}`);
      }
    }
  }

  for (const relativePath of RETIRED_PLATFORM_SCAN_FILES) {
    if (!exists(relativePath)) {
      errors.push(`required retired Platform scan target is missing: ${relativePath}`);
      continue;
    }
    const text = read(relativePath);
    for (const token of RETIRED_PLATFORM_TOKENS) {
      if (text.includes(token)) {
        errors.push(`${relativePath} still references retired Platform runtime: ${token}`);
      }
    }
  }

  const packageJson = JSON.parse(read("package.json"));
  const scripts = packageJson.scripts ?? {};
  if (!String(scripts.check ?? "").startsWith("npm run verify:core-lite-tree &&")) {
    errors.push("package.json check script must run verify:core-lite-tree first");
  }
  if (!scripts["archive:source"]) {
    errors.push("package.json is missing archive:source");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const result = verifyCoreLiteTree();
  if (!result.ok) {
    console.error("Core Lite tree verification failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Core Lite tree verification passed.");
  }
}
