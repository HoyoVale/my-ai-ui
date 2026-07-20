import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAgentToolSession } from "../../electron/tools/createAgentToolSession.js";
import { sha256Text } from "../../electron/tools/workspace/atomicFileWriter.js";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createSession(root, runtimeRoot, extra = {}) {
  return createAgentToolSession({
    taskId: "task-write",
    runId: "run-write",
    workspaceId: "workspace-write",
    segmentId: "segment-write",
    resultStoreDirectory: runtimeRoot,
    settings: {
      tools: {
        mode: "coding",
        runtime: {},
        workspace: {
          roots: [root],
          maxWriteFileBytes: 1_000_000
        },
        developer: {
          toolsetOverrides: {},
          toolOverrides: {}
        }
      }
    },
    ...extra
  });
}

describe("atomic workspace write tool", () => {
  it("writes through an atomic rename and stores hash evidence in a receipt", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-write-"));
    roots.push(root);
    const runtimeRoot = path.join(root, ".runtime-test");
    const session = createSession(root, runtimeRoot);

    const result = await session.tools.write_text_file.execute(
      {
        path: "src/example.txt",
        content: "hello runtime\n",
        createDirectories: true
      },
      { toolCallId: "write-call-1" }
    );

    assert.equal(result.ok, true);
    assert.equal(result.data.atomic, true);
    assert.equal(result.data.afterSha256, sha256Text("hello runtime\n"));
    assert.equal(
      fs.readFileSync(path.join(root, "src/example.txt"), "utf8"),
      "hello runtime\n"
    );

    const receiptDirectory = path.join(runtimeRoot, "runtime", "receipts");
    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(receiptDirectory, fs.readdirSync(receiptDirectory)[0]),
        "utf8"
      )
    );
    assert.equal(receipt.metadata.effectEvidence.sha256, result.data.afterSha256);
    assert.equal(receipt.metadata.effectEvidence.atomic, true);
    await session.closePersistence();
  });

  it("replays a verified receipt without rewriting the file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-replay-"));
    roots.push(root);
    const runtimeRoot = path.join(root, ".runtime-test");
    const input = {
      path: "answer.txt",
      content: "stable\n",
      createDirectories: false
    };

    const first = createSession(root, runtimeRoot);
    const initial = await first.tools.write_text_file.execute(input, {
      toolCallId: "write-call-replay"
    });
    assert.equal(initial.ok, true);
    await first.closePersistence();
    const target = path.join(root, "answer.txt");
    const before = fs.statSync(target).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = createSession(root, runtimeRoot);
    const replay = await second.tools.write_text_file.execute(input, {
      toolCallId: "write-call-replay"
    });
    assert.equal(replay.ok, true);
    assert.equal(fs.statSync(target).mtimeMs, before);
    assert.equal(
      second.getRecords().at(-1).runtime.replayed,
      true
    );
    await second.closePersistence();
  });

  it("rejects stale optimistic concurrency hashes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-conflict-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "note.txt"), "current");
    const session = createSession(root, path.join(root, ".runtime-test"));

    const result = await session.tools.write_text_file.execute(
      {
        path: "note.txt",
        content: "next",
        expectedSha256: "0".repeat(64),
        createDirectories: false
      },
      { toolCallId: "write-call-conflict" }
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "FILE_VERSION_CONFLICT");
    assert.equal(fs.readFileSync(path.join(root, "note.txt"), "utf8"), "current");
    await session.closePersistence();
  });

  it("surfaces a receipt verification mismatch instead of blindly replaying", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-verify-"));
    roots.push(root);
    const runtimeRoot = path.join(root, ".runtime-test");
    const input = {
      path: "state.txt",
      content: "expected",
      createDirectories: false
    };

    const first = createSession(root, runtimeRoot);
    await first.tools.write_text_file.execute(input, {
      toolCallId: "write-call-verify"
    });
    await first.closePersistence();
    fs.writeFileSync(path.join(root, "state.txt"), "changed externally");

    const second = createSession(root, runtimeRoot);
    const result = await second.tools.write_text_file.execute(input, {
      toolCallId: "write-call-verify"
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "TOOL_RECEIPT_VERIFICATION_FAILED");
    assert.equal(result.error.category, "needs_reconciliation");
    assert.equal(second.getRuntimeRecovery().needsReconciliation, 1);
    await second.closePersistence();
  });

  it("replaces an invalidated receipt after a verified repair", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-repair-"));
    roots.push(root);
    const runtimeRoot = path.join(root, ".runtime-test");
    const input = {
      path: "repair.txt",
      content: "desired state",
      createDirectories: false
    };

    const first = createSession(root, runtimeRoot);
    const original = await first.tools.write_text_file.execute(input, {
      toolCallId: "write-call-repair"
    });
    assert.equal(original.ok, true);
    await first.closePersistence();

    fs.writeFileSync(path.join(root, "repair.txt"), "external change");
    const second = createSession(root, runtimeRoot);
    const mismatch = await second.tools.write_text_file.execute(input, {
      toolCallId: "write-call-repair"
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.error.code, "TOOL_RECEIPT_VERIFICATION_FAILED");

    const repaired = await second.tools.write_text_file.execute(input, {
      toolCallId: "write-call-repair"
    });
    assert.equal(repaired.ok, true);
    assert.equal(fs.readFileSync(path.join(root, "repair.txt"), "utf8"), "desired state");
    assert.equal(second.getRuntimeRecovery().unresolvedCount, 0);
    assert.equal(second.getRuntimeDiagnostics().receiptCount, 1);
    assert.equal(
      fs.existsSync(path.join(runtimeRoot, "runtime", "invalidations")) &&
        fs.readdirSync(path.join(runtimeRoot, "runtime", "invalidations")).length > 0,
      false
    );
    await second.closePersistence();

    const third = createSession(root, runtimeRoot);
    const replay = await third.tools.write_text_file.execute(input, {
      toolCallId: "write-call-repair"
    });
    assert.equal(replay.ok, true);
    assert.equal(third.getRecords().at(-1).runtime.replayed, true);
    await third.closePersistence();
  });

});
