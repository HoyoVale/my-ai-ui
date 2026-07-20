import {
  afterEach,
  beforeEach,
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createWorkspaceGitReadToolDefinitions
} from "../../electron/tools/workspace/workspaceGitReadTools.js";

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-git-read-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function getTool() {
  return createWorkspaceGitReadToolDefinitions({ roots: [root] })[0];
}

function outcome(stdout = "") {
  return {
    ok: true,
    code: 0,
    signal: null,
    stdout,
    stderr: "",
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 5,
    terminated: false,
    terminationReason: null
  };
}

describe("git_diff", () => {
  it("builds host-controlled staged and unstaged diff calls", async () => {
    const calls = [];
    const supervisor = {
      async run(command, args, options) {
        calls.push({ command, args, options });
        return outcome(args.includes("--cached") ? "staged\n" : "unstaged\n");
      }
    };
    const tool = getTool();
    const input = tool.inputSchema.parse({
      mode: "all",
      paths: ["src/App.jsx"],
      contextLines: 5
    });
    const result = await tool.execute(input, {
      subprocessSupervisor: supervisor
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, "git");
    assert.equal(calls[0].options.shell, false);
    assert.deepEqual(calls[0].args.slice(0, 6), [
      "--no-pager",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--unified=5"
    ]);
    const separator = calls[0].args.indexOf("--");
    assert.deepEqual(calls[0].args.slice(separator, separator + 2), ["--", "src/App.jsx"]);
    assert.equal(calls[0].args.includes(":(exclude)**/.env"), true);
    assert.equal(calls[1].args.includes("--cached"), true);
    assert.match(result.diff, /Unstaged changes/u);
    assert.match(result.diff, /Staged changes/u);
    assert.equal(result.empty, false);
  });

  it("supports a bounded revision range and rejects unsafe values", async () => {
    const calls = [];
    const supervisor = {
      async run(command, args) {
        calls.push({ command, args });
        return outcome("range diff\n");
      }
    };
    const tool = getTool();
    const result = await tool.execute(tool.inputSchema.parse({
      mode: "range",
      base: "main",
      head: "feature/read-v2",
      maxOutputChars: 1_000
    }), {
      subprocessSupervisor: supervisor
    });

    assert.equal(calls[0].args.includes("main..feature/read-v2"), true);
    assert.equal(result.sections[0].kind, "range");

    await assert.rejects(
      tool.execute({
        mode: "range",
        base: "--output=/tmp/leak",
        paths: [],
        contextLines: 3,
        maxOutputChars: 10_000,
        timeoutMs: 30_000,
        cwd: "."
      }, {
        subprocessSupervisor: supervisor
      }),
      (error) => error?.code === "GIT_REVISION_BLOCKED"
    );

    await assert.rejects(
      tool.execute({
        mode: "unstaged",
        paths: [".env"],
        contextLines: 3,
        maxOutputChars: 10_000,
        timeoutMs: 30_000,
        cwd: "."
      }, {
        subprocessSupervisor: supervisor
      }),
      (error) => error?.code === "GIT_PATHSPEC_BLOCKED"
    );

    await assert.rejects(
      tool.execute({
        mode: "unstaged",
        paths: ["../outside"],
        contextLines: 3,
        maxOutputChars: 10_000,
        timeoutMs: 30_000,
        cwd: "."
      }, {
        subprocessSupervisor: supervisor
      }),
      (error) => error?.code === "GIT_PATHSPEC_BLOCKED"
    );
  });

  it("surfaces a failed Git process as a Tool failure", async () => {
    const supervisor = {
      async run() {
        return {
          ...outcome(""),
          ok: false,
          code: 128,
          stderr: "not a git repository",
          stderrBytes: 20
        };
      }
    };
    const tool = getTool();
    await assert.rejects(
      tool.execute(tool.inputSchema.parse({ mode: "unstaged" }), {
        subprocessSupervisor: supervisor
      }),
      (error) => error?.code === "GIT_DIFF_FAILED"
    );
  });

  it("truncates combined diff output at the configured result boundary", async () => {
    const supervisor = {
      async run() {
        return outcome("x".repeat(2_000));
      }
    };
    const tool = getTool();
    const result = await tool.execute(tool.inputSchema.parse({
      mode: "unstaged",
      maxOutputChars: 1_000
    }), {
      subprocessSupervisor: supervisor
    });

    assert.equal(result.truncated, true);
    assert.match(result.diff, /truncated by git_diff/u);
  });
});
