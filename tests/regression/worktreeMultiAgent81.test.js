import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("80 provides an isolated recoverable Worktree Runtime", () => {
  const runtime = source("electron/platform/WorktreeRuntime.js");
  assert.match(runtime, /GIT_INDEX_FILE/u);
  assert.match(runtime, /worktree", "add"/u);
  assert.match(runtime, /capturedDirtyState/u);
  assert.match(runtime, /checkpointCommit/u);
  assert.match(runtime, /orphaned-worktree-recovered/u);
  assert.doesNotMatch(runtime, /node:child_process/u);
});

test("81 delegates bounded tasks through a real Supervisor", () => {
  const agent = source("electron/agent/AgentRuntime.js");
  const supervisor = source("electron/platform/MultiAgentSupervisor.js");
  const delegation = source("electron/platform/delegationTools.js");
  assert.match(agent, /createDelegationToolDefinition/u);
  assert.match(delegation, /delegate_tasks/u);
  assert.match(delegation, /max\(4\)/u);
  assert.match(supervisor, /Promise\.all/u);
  assert.match(supervisor, /getMaxConcurrency/u);
  assert.match(supervisor, /recordAgentHandoff/u);
  assert.match(supervisor, /READ_ONLY_ROLES/u);
});

test("main and Worker model routing are independently configurable", () => {
  const panel = source("src/Setting/panels/ModelPanel.jsx");
  const resolver = source("electron/settings/modelSettings.js");
  const validation = source("electron/settings/validateSettings.js");
  assert.match(panel, /main-model-assignment/u);
  assert.match(panel, /worker-model-assignment/u);
  assert.match(panel, /Worker 并发数/u);
  assert.match(resolver, /resolveWorkerModelSettings/u);
  assert.match(validation, /runtimeAssignments/u);
});

test("the MCP SDK transitively uses a patched Hono server", () => {
  const manifest = JSON.parse(source("package.json"));
  const lock = JSON.parse(source("package-lock.json"));
  assert.equal(manifest.dependencies["@modelcontextprotocol/sdk"], "^1.29.0");
  assert.equal(manifest.overrides["@hono/node-server"], "2.0.11");
  assert.equal(lock.packages["node_modules/@hono/node-server"].version, "2.0.11");
});
