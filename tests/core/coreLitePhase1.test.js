import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const source = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("Core Lite disables Plan and Goal prompt/tool entrances", () => {
  const prompt = source("electron/context/baseSystemContext.js");
  const assembler = source("electron/context/ContextAssembler.js");
  const registry = source("electron/tools/manifest/createBuiltinToolRegistry.js");
  const defaults = source("src/shared/defaultSettings.js");
  const catalog = source("electron/tools/toolCatalog.js");

  assert.doesNotMatch(prompt, /使用 update_plan|replan_goal|update_step_work/u);
  assert.doesNotMatch(assembler, /persistent goal|goalEnabled|update_plan|replan_goal/u);
  assert.match(registry, /includePlanTools: !CORE_LITE_MODE/u);
  assert.match(catalog, /!isCoreLiteDisabledTool\(name\)/u);
  assert.match(defaults, /update_plan: false/u);
  assert.match(defaults, /replan_goal: false/u);
  assert.match(defaults, /update_step_work: false/u);
});

test("Core Lite removes Goal Plan and Platform user interfaces", () => {
  const conversation = source("src/Conversation/Conversation.jsx");
  const topbar = source("src/Conversation/components/Topbar.jsx");
  const taskPanel = source("src/Conversation/components/TaskPanel.jsx");
  const taskPanelModel = source("src/Conversation/components/taskPanelModel.js");
  const contextInspector = source("src/Conversation/components/ContextInspector.jsx");
  const inputMenu = source("src/Input/components/ContextMenu.jsx");
  const slash = source("src/Input/utils/slashCommand.js");
  const modelPanel = source("src/Setting/panels/ModelPanel.jsx");

  for (const text of [conversation, topbar, taskPanel, inputMenu]) {
    assert.doesNotMatch(text, /GoalPanel|PlanDock|PlatformDock|conversation-goal-toggle/u);
  }
  assert.doesNotMatch(inputMenu, /input-context-goal|renderGoalPage/u);
  assert.match(taskPanelModel, /"summary", "batch", "plan"/u);
  assert.doesNotMatch(contextInspector, /Goal 累计/u);
  assert.doesNotMatch(slash, /platformView|id: "goal"|id: "plan"|id: "agents"/u);
  assert.doesNotMatch(modelPanel, /Worker 模型|多 Agent|worker-model-assignment/u);
});

test("Core Lite does not register or start Platform Runtime", () => {
  const main = source("electron/main.js");
  const ipc = source("electron/ipc/registerIpcHandlers.js");
  const conversationIndex = source("electron/conversation/index.js");
  const preparation = source("electron/agent/preparation/AgentRunPreparation.js");
  const execution = source("electron/agent/execution/AgentRunExecution.js");
  const finalization = source("electron/agent/finalization/AgentRunFinalization.js");

  assert.doesNotMatch(main, /platform\/index|platformKernel|longRunningAgentService|worktreeRuntime/u);
  assert.doesNotMatch(ipc, /registerPlatformIpc/u);
  assert.doesNotMatch(conversationIndex, /platform\/index/u);
  for (const text of [preparation, execution, finalization]) {
    assert.doesNotMatch(text, /platformKernel|platform\/(?:index|coreLitePlatform)|delegationTools/u);
  }
});

test("Core Lite keeps foundational Agent capabilities wired", () => {
  const execution = source("electron/agent/execution/AgentRunExecution.js");
  const session = source("electron/tools/createAgentToolSession.js");
  const settings = source("src/shared/defaultSettings.js");

  assert.match(execution, /mcpClientManager/u);
  assert.match(execution, /declarativeHttpToolManager/u);
  assert.match(session, /ToolRuntime/u);
  assert.match(session, /ToolExecutionLedger/u);
  assert.match(settings, /memory:\s*\{[\s\S]*enabled: true/u);
  assert.match(settings, /mcp:\s*\{[\s\S]*enabled: true/u);
  assert.match(settings, /read_tool_result: true/u);
});

test("Core Lite full validation excludes dormant advanced-runtime E2E", () => {
  const manifest = JSON.parse(source("package.json"));
  const fullCheck = manifest.scripts["check:full"];

  assert.doesNotMatch(
    fullCheck,
    /goal-crash|supervisor-crash|long-running-crash|platform-crash|worktree-crash/u
  );
  assert.match(fullCheck, /runtime-crash/u);
  assert.match(fullCheck, /runtime-write-crash/u);
  assert.match(fullCheck, /test:electron/u);
  assert.match(fullCheck, /test:e2e/u);
});
