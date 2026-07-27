import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyCoreLiteTree } from "../../scripts/verify-core-lite-tree.mjs";
import { sanitizeSettings } from "../../electron/settings/validateSettings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Core Lite 3.6 P1 physically removes Platform and Multi-Agent runtime source", () => {
  for (const relativePath of [
    "electron/platform",
    "tests/platform",
    "tests/e2e/platform-kernel-crash-recovery.mjs",
    "tests/e2e/worktree-runtime-crash-recovery.mjs",
    "tests/e2e/multi-agent-supervisor-crash-recovery.mjs",
    "tests/e2e/long-running-agent-crash-recovery.mjs",
    "tests/fixtures/long-running-agent-crash-worker.mjs"
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  }
});

test("Core Lite 3.6 P1 keeps the Coding subprocess foundation", () => {
  assert.equal(fs.existsSync(path.join(root, "electron/tools/process/SubprocessSupervisor.js")), true);
  const processTools = read("electron/tools/workspace/workspaceProcessTools.js");
  assert.match(processTools, /context\.subprocessSupervisor\.run/u);
});

test("Core Lite 3.6 P1 removes Platform crash scripts from package and CI", () => {
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");
  for (const script of [
    "test:e2e:platform-crash",
    "test:e2e:worktree-crash",
    "test:e2e:supervisor-crash",
    "test:e2e:long-running-crash"
  ]) {
    assert.equal(Object.hasOwn(packageJson.scripts, script), false, script);
  }
  assert.doesNotMatch(ci, /goal-crash|platform-crash|worktree-crash|supervisor-crash|long-running-crash/u);
});

test("Core Lite 3.6 P1 drops retired Worker runtime settings", () => {
  const sanitized = sanitizeSettings({
    model: {
      runtimeAssignments: {
        worker: { providerId: "worker", modelConfigId: "model" },
        maxConcurrency: 4
      }
    }
  });
  assert.equal(Object.hasOwn(sanitized.model, "runtimeAssignments"), false);
  assert.doesNotMatch(read("src/shared/defaultSettings.js"), /runtimeAssignments|WORKER_RUNTIME/u);
  assert.doesNotMatch(read("electron/settings/modelSettings.js"), /resolveWorkerModelSettings/u);
});

test("Core Lite 3.6 P1 tree verifier locks the Platform removal boundary", () => {
  assert.deepEqual(verifyCoreLiteTree(), { ok: true, errors: [] });
});
