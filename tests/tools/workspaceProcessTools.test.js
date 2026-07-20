import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAgentToolSession } from "../../electron/tools/createAgentToolSession.js";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function session(root, developer = true) {
  return createAgentToolSession({
    taskId: "task-process",
    runId: "run-process",
    workspaceId: "workspace-process",
    segmentId: "segment-process",
    resultStoreDirectory: path.join(root, ".runtime"),
    settings: {
      tools: {
        mode: "coding",
        runtime: { defaultTimeoutMs: 15_000 },
        workspace: { roots: [root] },
        developer: {
          toolsetOverrides: developer
            ? { "workspace.exec": "enabled" }
            : {},
          toolOverrides: {}
        }
      }
    }
  });
}

describe("supervised workspace process tools", () => {
  it("keeps process execution opt-in", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-proc-off-"));
    roots.push(root);
    const value = session(root, false);
    assert.equal("git_inspect" in value.tools, false);
    assert.equal("run_workspace_command" in value.tools, false);
  });

  it("runs an allowlisted executable without a shell", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-proc-"));
    roots.push(root);
    const value = session(root, true);
    const result = await value.tools.run_workspace_command.execute(
      {
        command: "node",
        args: ["-e", "process.stdout.write('supervised')"],
        cwd: ".",
        timeoutMs: 10_000
      },
      { toolCallId: "process-call-1" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.stdout, "supervised");
    assert.equal(result.data.terminated, false);
    await value.closePersistence();
  });

  it("blocks commands outside the explicit allowlist", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-proc-block-"));
    roots.push(root);
    const value = session(root, true);
    const result = await value.tools.run_workspace_command.execute(
      {
        command: "sh",
        args: ["-c", "echo unsafe"],
        cwd: ".",
        timeoutMs: 10_000
      },
      { toolCallId: "process-call-block" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "COMMAND_NOT_ALLOWED");
    await value.closePersistence();
  });
});
