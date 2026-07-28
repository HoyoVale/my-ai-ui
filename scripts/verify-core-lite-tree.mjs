import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

const FORBIDDEN_PATHS = Object.freeze([
  "electron/goal",
  "electron/execution-model",
  "electron/platform",
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
  "electron/ipc/handlers/platformIpc.js",
  "src/shared/runtimeDefaults.js",
  "src/Conversation/components/GoalPanel.jsx",
  "src/Conversation/components/PlanDock.jsx",
  "src/Conversation/components/PlatformDock.jsx",
  "src/Conversation/styles/plan-goal.css",
  "src/Conversation/styles/platform.css",
  "tests/goal",
  "tests/execution-model",
  "tests/platform",
  "tests/e2e/goal-runtime-crash-recovery.mjs",
  "tests/e2e/platform-kernel-crash-recovery.mjs",
  "tests/e2e/worktree-runtime-crash-recovery.mjs",
  "tests/e2e/multi-agent-supervisor-crash-recovery.mjs",
  "tests/e2e/long-running-agent-crash-recovery.mjs",
  "tests/fixtures/goal-runtime-crash-worker.mjs",
  "tests/fixtures/long-running-agent-crash-worker.mjs",
  "tests/conversation/conversationGoal.test.js",
  "tests/conversation/executionThreadPersistence97.test.js",
  "tests/conversation/planCore2Persistence.test.js",
  "tests/regression/segmentContinuationContract.test.js",
  "tests/regression/executionConsistencyArchitecture97.test.js",
  "tests/regression/platformKernel79.test.js",
  "tests/regression/coreLiteHistoricalPlanViewContract.test.js",
  "docs/GOAL_V2_AND_SLASH_COMMANDS_78.md",
  "docs/PLAN_CORE_2_0_71.md",
  "docs/PLAN_UI_2_0_72.md",
  "docs/CONTINUITY_PLAN_AUTHORITY_93.md",
  "docs/EXECUTION_CONSISTENCY_CORE_ARCHITECTURE_97.md",
  "docs/EXECUTION_MODEL_2_ARCHITECTURE_PLAN.md",
  "docs/EXECUTION_MODEL_2_PHASE_A_102.md",
  "docs/EXECUTION_MODEL_2_PHASE_B_103.md",
  "docs/EXECUTION_MODEL_2_PHASE_C_104.md",
  "docs/EXECUTION_MODEL_2_PHASE_D_105.md",
  "docs/EXECUTION_MODEL_2_PHASE_E_106.md",
  "docs/EXECUTION_MODEL_2_PHASE_F_107.md",
  "docs/EXECUTION_MODEL_2_PHASE_G_108.md",
  "docs/EXECUTION_RUNTIME_STABILITY_P0_109.md",
  "docs/EXECUTION_RUNTIME_STABILITY_PLAN.md",
  "temp.log"
]);

const RETIRED_SURFACE_TOKENS = Object.freeze([
  "input-slash-command-goal",
  "input-goal-criteria",
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

const RETIRED_RUNTIME_TOKENS = Object.freeze([
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

const RETIRED_READ_ALIAS_TOKENS = Object.freeze([
  "projectLegacyConversationFields",
  "projectConversationForRead",
  "projectMessageForRead",
  "legacyAdvancedReadOnly",
  "currentSegmentId",
  "maxNoProgressSegments",
  "maxSegments"
]);

const SURFACE_SCAN_FILES = Object.freeze([
  "tests/e2e/conversation-flow.cjs",
  "electron/shared/ipcChannels.cjs",
  "electron/preload/preload.cjs"
]);

const RUNTIME_SCAN_FILES = Object.freeze([
  "package.json",
  ".github/workflows/ci.yml",
  "src/shared/defaultSettings.js",
  "electron/settings/validateSettings.js",
  "electron/settings/modelSettings.js"
]);

const ALIAS_SCAN_FILES = Object.freeze([
  "electron/conversation/conversationSchema.js",
  "electron/conversation/services/ConversationStateService.js",
  "electron/agent/AgentRunSession.js",
  "electron/agent/AgentRuntime.js",
  "electron/agent/execution/AgentRunExecution.js",
  "src/Setting/panels/ToolPanel.jsx",
  "src/shared/defaultSettings.js",
  "electron/settings/validateSettings.js"
]);

function exists(relativePath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

function scanTokens(errors, files, tokens, label) {
  for (const relativePath of files) {
    if (!exists(relativePath)) {
      errors.push(`required ${label} target is missing: ${relativePath}`);
      continue;
    }
    const text = read(relativePath);
    for (const token of tokens) {
      if (text.includes(token)) {
        errors.push(`${relativePath} still references retired ${label}: ${token}`);
      }
    }
  }
}

export function verifyCoreLiteTree() {
  const errors = [];

  for (const relativePath of FORBIDDEN_PATHS) {
    if (exists(relativePath)) {
      errors.push(`forbidden path exists: ${relativePath}`);
    }
  }

  scanTokens(errors, SURFACE_SCAN_FILES, RETIRED_SURFACE_TOKENS, "surface");
  scanTokens(errors, RUNTIME_SCAN_FILES, RETIRED_RUNTIME_TOKENS, "runtime");
  scanTokens(errors, ALIAS_SCAN_FILES, RETIRED_READ_ALIAS_TOKENS, "active alias");

  for (const relativePath of [
    "electron/conversation/legacyGoalSnapshot.js",
    "electron/conversation/legacyPlanSnapshot.js",
    "electron/conversation/legacyExecutionSnapshot.js",
    "electron/conversation/legacyConversationCompatibility.js",
    "electron/windows/response/ResponseStreamReplayBuffer.js",
    "tests/stress/runtimeFaultInjection.test.js",
    "tests/performance/core-lite-lifecycle-soak.mjs",
    "tests/e2e/electron-release-candidate.cjs",
    "tests/e2e/helpers/electronHarness.cjs",
    "tests/e2e/helpers/releaseCandidateReport.cjs",
    "tests/agent/e2eLongStreamDriver.test.js",
    "tests/release/releaseCandidateSummary.test.js",
    "scripts/create-release-candidate-summary.mjs",
    "docs/CORE_LITE_ARCHITECTURE.md",
    "docs/LEGACY_HISTORY_COMPATIBILITY.md",
    "docs/CORE_LITE_PHASE4_7_129.md",
    "docs/CORE_LITE_PHASE4_8_130.md",
    "docs/CORE_LITE_RELEASE_CANDIDATE.md",
    "electron/shared/rendererTarget.js",
    "electron/update/UpdateService.js",
    "electron/update/index.js",
    "electron/ipc/handlers/updateIpc.js",
    "electron-builder.yml",
    "build/entitlements.mac.plist",
    ".github/workflows/release.yml",
    "scripts/bootstrap-release-dependencies.mjs",
    "scripts/run-electron-builder.mjs",
    "scripts/verify-release-version.mjs",
    "scripts/verify-signing-environment.mjs",
    "scripts/verify-release-artifacts.mjs",
    "scripts/create-release-manifest.mjs",
    "tests/release/updateService.test.js",
    "tests/release/releasePackagingContract.test.js",
    "tests/release/releaseScripts.test.js",
    "tests/regression/packagedRendererContract.test.js",
    "docs/RELEASE.md",
    "docs/CORE_LITE_PHASE4_9_134.md"
  ]) {
    if (!exists(relativePath)) {
      errors.push(`required compatibility contract is missing: ${relativePath}`);
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
  if (!scripts["test:core-lite"]) {
    errors.push("package.json is missing test:core-lite");
  }
  for (const scriptName of [
    "test:core-lite4.7",
    "test:stress:core-lite4.7",
    "test:soak:core-lite4.7",
    "test:core-lite4.8",
    "test:stress:core-lite4.8",
    "test:soak:core-lite4.8",
    "test:e2e:electron-rc",
    "report:core-lite4.8",
    "test:core-lite4.9",
    "release:bootstrap",
    "release:validate",
    "release:package",
    "release:manifest",
    "release:verify-artifacts"
  ]) {
    if (!scripts[scriptName]) {
      errors.push(`package.json is missing ${scriptName}`);
    }
  }

  const workflow = read(".github/workflows/ci.yml");
  if (!workflow.includes("npm run test:stress:core-lite4.8")) {
    errors.push("CI is missing the Core Lite 4.8 stress gate");
  }
  if (!workflow.includes("npm run test:e2e:electron-rc")) {
    errors.push("CI is missing the Core Lite 4.8 Electron release gate");
  }
  if (!workflow.includes("--require-platforms=linux,win32")) {
    errors.push("CI is missing the cross-platform release summary gate");
  }

  const releaseWorkflow = read(".github/workflows/release.yml");
  for (const token of [
    "verify-signing-environment.mjs",
    "Get-AuthenticodeSignature",
    "codesign --verify",
    "xcrun stapler validate",
    "if: github.event_name != 'workflow_dispatch' || !inputs.allow_unsigned",
    "release-manifest.json",
    "gh release create"
  ]) {
    if (!releaseWorkflow.includes(token)) {
      errors.push(`Release workflow is missing: ${token}`);
    }
  }

  const rendererRoutes = read("electron/shared/rendererRoutes.js");
  const viteConfig = read("vite.config.js");
  if (!rendererRoutes.includes("app.isPackaged")) {
    errors.push("Packaged renderer routing must use app.isPackaged");
  }
  if (!viteConfig.includes("base: './'")) {
    errors.push("Vite must use a relative production asset base");
  }

  const gitignore = read(".gitignore");
  const archiveScript = read("scripts/create-source-archive.mjs");
  for (const generatedPath of [
    "test-results/",
    "playwright-report/",
    "release/",
    "release-artifacts/"
  ]) {
    if (!gitignore.includes(generatedPath)) {
      errors.push(`.gitignore must exclude generated output: ${generatedPath}`);
    }
  }
  for (const generatedName of [
    "test-results",
    "playwright-report",
    "release",
    "release-artifacts"
  ]) {
    if (!archiveScript.includes(`"${generatedName}"`)) {
      errors.push(`source archive must exclude generated output: ${generatedName}`);
    }
  }

  return { ok: errors.length === 0, errors };
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
