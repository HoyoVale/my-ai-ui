import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWorkspaceProcessToolDefinitions } from "../../electron/tools/workspace/workspaceProcessTools.js";
import { createAgentToolSession } from "../../electron/tools/createAgentToolSession.js";
import { SubprocessSupervisor } from "../../electron/tools/process/SubprocessSupervisor.js";

const roots = [];
after(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function rootWithPackage(scripts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-project-script-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts }, null, 2));
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n");
  return root;
}

function fakeOutcome(overrides = {}) {
  return {
    ok: true,
    code: 0,
    signal: null,
    stdout: "passed\n",
    stderr: "",
    stdoutBytes: 7,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 12,
    terminated: false,
    terminationReason: null,
    ...overrides
  };
}

function processDefinitions(root, allowedCommands = []) {
  return createWorkspaceProcessToolDefinitions({
    roots: [root],
    allowedCommands,
    controlledProcess: true
  });
}

function session(root, { developer = false, allowedCommands = [], onRecord = null } = {}) {
  return createAgentToolSession({
    taskId: "task-process",
    runId: "run-process",
    workspaceId: "workspace-process",
    segmentId: "segment-process",
    resultStoreDirectory: path.join(root, ".runtime"),
    onRecord,
    settings: {
      tools: {
        mode: "coding",
        runtime: { defaultTimeoutMs: 15_000 },
        workspace: { roots: [root], allowedCommands, controlledProcess: true },
        developer: {
          toolsetOverrides: developer ? { "workspace.exec": "enabled" } : {},
          toolOverrides: {}
        }
      }
    }
  });
}

describe("supervised workspace process tools", () => {
  it("exposes safe project scripts in Coding mode without exposing arbitrary commands", async () => {
    const root = rootWithPackage({ test: "node tests.js" });
    const value = session(root);
    assert.equal("git_inspect" in value.tools, true);
    assert.equal("run_project_script" in value.tools, true);
    assert.equal("run_workspace_command" in value.tools, false);
    await value.closePersistence();
  });

  it("publishes a safe command preview before a supervised command finishes", async () => {
    const root = rootWithPackage({});
    const records = [];
    const value = session(root, { onRecord: (record) => records.push(record) });
    const result = await value.tools.git_inspect.execute({
      command: "status",
      args: ["--short"],
      cwd: ".",
      timeoutMs: 10_000
    }, { toolCallId: "git-preview" });
    assert.equal(result.ok, false);
    const running = records.find((record) => record.id === "git-preview" && record.status === "running");
    assert.match(running.commandPreview.displayCommand, /^git /u);
    assert.equal(running.commandPreview.kind, "git_inspect");
    await value.closePersistence();
  });

  it("uses a host-constructed launcher without user-provided shell fragments", async () => {
    const root = rootWithPackage({ test: "node tests.js" });
    const tool = processDefinitions(root).find((definition) => definition.name === "run_project_script");
    const calls = [];
    const progress = [];
    const result = await tool.execute({ task: "test", cwd: ".", timeoutMs: 10_000 }, {
      onToolProgress: (value) => progress.push(value),
      subprocessSupervisor: {
        async run(command, args, options) {
          calls.push({ command, args, options });
          options.onStdout?.("running tests\n");
          return fakeOutcome();
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.kind, "project_script");
    assert.equal(result.data.script, "test");
    assert.equal(result.data.displayCommand, "npm run test");
    if (process.platform === "win32") {
      assert.equal(calls[0].command, process.env.ComSpec || "cmd.exe");
      assert.deepEqual(calls[0].args, ["/d", "/s", "/c", "npm.cmd run test"]);
    } else {
      assert.equal(calls[0].command, "npm");
      assert.deepEqual(calls[0].args, ["run", "test"]);
    }
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.cwd, root);
    assert.equal(Boolean(calls[0].options.env.CI), true);
    assert.match(progress.at(-1).commandPreview.stdout, /running tests/u);
    assert.equal(progress.at(-1).commandPreview.exitCode, null);
  });

  it("executes a declared project script through the real supervised process tree", async () => {
    const root = rootWithPackage({ probe: "node -e \"process.stdout.write('probe-ok')\"" });
    const tool = processDefinitions(root).find((definition) => definition.name === "run_project_script");
    const result = await tool.execute({ task: "script", script: "probe", cwd: ".", timeoutMs: 30_000 }, {
      subprocessSupervisor: new SubprocessSupervisor({ defaultTimeoutMs: 30_000 })
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.exitCode, 0);
    assert.match(result.data.stdout, /probe-ok/u);
    assert.equal(result.data.displayCommand, "npm run probe");
  });

  it("rejects scripts that are not declared in package.json", async () => {
    const root = rootWithPackage({ test: "node tests.js" });
    const tool = processDefinitions(root).find((definition) => definition.name === "run_project_script");
    await assert.rejects(
      () => tool.execute({ task: "script", script: "publish", cwd: ".", timeoutMs: 10_000 }, {
        subprocessSupervisor: { run: async () => fakeOutcome() }
      }),
      (error) => error?.code === "PACKAGE_SCRIPT_NOT_FOUND"
    );
  });

  it("keeps arbitrary executables behind the explicit developer allowlist", async () => {
    const root = rootWithPackage({ test: "node tests.js" });
    const value = session(root, { developer: true, allowedCommands: [] });
    assert.equal("run_workspace_command" in value.tools, false);
    await value.closePersistence();
  });

  it("blocks mutating git branch options before starting a process", async () => {
    const root = rootWithPackage({});
    const tool = processDefinitions(root).find((definition) => definition.name === "git_inspect");
    await assert.rejects(
      () => tool.execute({ command: "branch", args: ["-D", "main"], cwd: ".", timeoutMs: 10_000 }, {
        subprocessSupervisor: { run: async () => fakeOutcome() }
      }),
      (error) => error?.code === "GIT_COMMAND_BLOCKED"
    );
  });
});
