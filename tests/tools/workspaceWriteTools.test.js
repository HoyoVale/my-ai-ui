import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAgentToolSession } from "../../electron/tools/createAgentToolSession.js";
import { sha256Text } from "../../electron/tools/workspace/atomicFileWriter.js";
import { createWorkspaceWriteToolDefinitions } from "../../electron/tools/workspace/workspaceWriteTools.js";

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

  it("supports dry-run and preserves UTF-8 BOM plus CRLF by default", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-write-codec-"));
    roots.push(root);
    const target = path.join(root, "codec.txt");
    fs.writeFileSync(target, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("old\r\nvalue\r\n", "utf8")
    ]));
    const session = createSession(root, path.join(root, ".runtime-test"));
    const before = fs.readFileSync(target);

    const preview = await session.tools.write_text_file.execute({
      path: "codec.txt",
      content: "new\nvalue\n",
      dryRun: true
    }, { toolCallId: "write-codec-preview" });

    assert.equal(preview.ok, true);
    assert.equal(preview.data.dryRun, true);
    assert.match(preview.data.receiptId, /^[0-9a-f-]{36}$/u);
    assert.deepEqual(fs.readFileSync(target), before);

    const written = await session.tools.write_text_file.execute({
      path: "codec.txt",
      content: "new\nvalue\n"
    }, { toolCallId: "write-codec-apply" });

    assert.equal(written.ok, true);
    assert.equal(written.data.encoding, "utf8");
    assert.equal(written.data.bom, true);
    assert.equal(written.data.newline, "crlf");
    assert.deepEqual(
      fs.readFileSync(target),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("new\r\nvalue\r\n", "utf8")
      ])
    );
    await session.closePersistence();
  });

  it("enforces create-only and overwrite intent before mutation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-write-intent-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "existing.txt"), "stable");
    const session = createSession(root, path.join(root, ".runtime-test"));

    const createOnly = await session.tools.write_text_file.execute({
      path: "existing.txt",
      content: "changed",
      createOnly: true
    }, { toolCallId: "write-create-only" });
    assert.equal(createOnly.ok, false);
    assert.equal(createOnly.error.code, "FILE_EXISTS");

    const noOverwrite = await session.tools.write_text_file.execute({
      path: "existing.txt",
      content: "changed",
      overwrite: false
    }, { toolCallId: "write-no-overwrite" });
    assert.equal(noOverwrite.ok, false);
    assert.equal(noOverwrite.error.code, "FILE_EXISTS");
    assert.equal(fs.readFileSync(path.join(root, "existing.txt"), "utf8"), "stable");
    await session.closePersistence();
  });

  it("replaces only the explicitly expected number of text occurrences", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-replace-"));
    roots.push(root);
    const target = path.join(root, "replace.txt");
    fs.writeFileSync(target, "same\nsame\n", "utf8");
    const session = createSession(root, path.join(root, ".runtime-test"));

    const ambiguous = await session.tools.replace_text_in_file.execute({
      path: "replace.txt",
      oldText: "same",
      newText: "next"
    }, { toolCallId: "replace-ambiguous" });
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.error.code, "CONTENT_OCCURRENCE_MISMATCH");
    assert.equal(fs.readFileSync(target, "utf8"), "same\nsame\n");

    const replaced = await session.tools.replace_text_in_file.execute({
      path: "replace.txt",
      oldText: "same",
      newText: "next",
      expectedOccurrences: 2
    }, { toolCallId: "replace-exact" });
    assert.equal(replaced.ok, true);
    assert.equal(replaced.data.occurrences, 2);
    assert.equal(replaced.data.addedLines, 2);
    assert.equal(replaced.data.removedLines, 2);
    assert.equal(fs.readFileSync(target, "utf8"), "next\nnext\n");
    await session.closePersistence();
  });

  it("requires explicit file creation for append and inserts a safe separator", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-append-"));
    roots.push(root);
    const session = createSession(root, path.join(root, ".runtime-test"));

    const missing = await session.tools.append_text_file.execute({
      path: "log.txt",
      content: "second"
    }, { toolCallId: "append-missing" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "PATH_NOT_FOUND");

    const created = await session.tools.append_text_file.execute({
      path: "log.txt",
      content: "first",
      createIfMissing: true
    }, { toolCallId: "append-create" });
    assert.equal(created.ok, true);
    assert.equal(created.data.created, true);

    const appended = await session.tools.append_text_file.execute({
      path: "log.txt",
      content: "second"
    }, { toolCallId: "append-existing" });
    assert.equal(appended.ok, true);
    assert.equal(fs.readFileSync(path.join(root, "log.txt"), "utf8"), "first\nsecond");
    await session.closePersistence();
  });

  it("creates directories and atomically moves paths without overwriting", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-move-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "source.txt"), "move me", "utf8");
    const session = createSession(root, path.join(root, ".runtime-test"));

    const preview = await session.tools.create_directory.execute({
      path: "nested/folder",
      recursive: true,
      dryRun: true
    }, { toolCallId: "mkdir-preview" });
    assert.equal(preview.ok, true);
    assert.equal(fs.existsSync(path.join(root, "nested")), false);

    const created = await session.tools.create_directory.execute({
      path: "nested/folder",
      recursive: true
    }, { toolCallId: "mkdir-apply" });
    assert.equal(created.ok, true);
    assert.equal(fs.statSync(path.join(root, "nested/folder")).isDirectory(), true);

    const moved = await session.tools.move_path.execute({
      source: "source.txt",
      destination: "nested/folder/destination.txt"
    }, { toolCallId: "move-apply" });
    assert.equal(moved.ok, true);
    assert.equal(fs.existsSync(path.join(root, "source.txt")), false);
    assert.equal(fs.readFileSync(path.join(root, "nested/folder/destination.txt"), "utf8"), "move me");

    fs.writeFileSync(path.join(root, "other.txt"), "other", "utf8");
    const conflict = await session.tools.move_path.execute({
      source: "other.txt",
      destination: "nested/folder/destination.txt"
    }, { toolCallId: "move-conflict" });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, "DESTINATION_EXISTS");
    assert.equal(fs.readFileSync(path.join(root, "other.txt"), "utf8"), "other");
    await session.closePersistence();
  });

  it("dry-runs and transactionally applies a multi-file unified patch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-patch-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "one.txt"), "alpha\nbeta\n", "utf8");
    fs.writeFileSync(path.join(root, "two.txt"), "red\nblue\n", "utf8");
    const runtimeRoot = path.join(root, ".runtime-test");
    const session = createSession(root, runtimeRoot);
    const patch = [
      "--- a/one.txt",
      "+++ b/one.txt",
      "@@ -1,2 +1,2 @@",
      " alpha",
      "-beta",
      "+gamma",
      "--- a/two.txt",
      "+++ b/two.txt",
      "@@ -1,2 +1,2 @@",
      " red",
      "-blue",
      "+green",
      ""
    ].join("\n");

    const preview = await session.tools.apply_patch.execute({
      patch,
      dryRun: true
    }, { toolCallId: "patch-preview" });
    assert.equal(preview.ok, true);
    assert.equal(preview.data.fileCount, 2);
    assert.equal(fs.readFileSync(path.join(root, "one.txt"), "utf8"), "alpha\nbeta\n");

    const applied = await session.tools.apply_patch.execute({ patch }, {
      toolCallId: "patch-apply"
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.data.addedLines, 2);
    assert.equal(applied.data.removedLines, 2);
    assert.equal(fs.readFileSync(path.join(root, "one.txt"), "utf8"), "alpha\ngamma\n");
    assert.equal(fs.readFileSync(path.join(root, "two.txt"), "utf8"), "red\ngreen\n");

    const receipts = fs.readdirSync(path.join(runtimeRoot, "runtime", "receipts"))
      .map((name) => JSON.parse(fs.readFileSync(path.join(runtimeRoot, "runtime", "receipts", name), "utf8")));
    const receipt = receipts.find((item) => item.callId === "patch-apply");
    assert.equal(receipt.receiptId, applied.data.receiptId);
    assert.deepEqual(receipt.metadata.effectEvidence.affectedPaths, ["one.txt", "two.txt"]);
    await session.closePersistence();
  });

  it("rolls back all already committed files when a patch transaction fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-patch-rollback-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "one.txt"), "one\n", "utf8");
    fs.writeFileSync(path.join(root, "two.txt"), "two\n", "utf8");
    const definition = createWorkspaceWriteToolDefinitions({
      roots: [root],
      maxWriteFileBytes: 1_000_000
    }).find((item) => item.name === "apply_patch");
    const patch = [
      "--- a/one.txt",
      "+++ b/one.txt",
      "@@ -1 +1 @@",
      "-one",
      "+ONE",
      "--- a/two.txt",
      "+++ b/two.txt",
      "@@ -1 +1 @@",
      "-two",
      "+TWO",
      ""
    ].join("\n");
    let committed = 0;

    await assert.rejects(
      () => definition.execute({
        patch,
        expectedSha256: {},
        createDirectories: false,
        dryRun: false
      }, {
        callId: "patch-rollback",
        idempotencyKey: "patch-rollback",
        onWriteBoundary(boundary) {
          if (boundary === "transaction_file_committed" && ++committed === 1) {
            throw Object.assign(new Error("injected transaction failure"), {
              code: "INJECTED_FAILURE"
            });
          }
        }
      }),
      /injected transaction failure/u
    );

    assert.equal(fs.readFileSync(path.join(root, "one.txt"), "utf8"), "one\n");
    assert.equal(fs.readFileSync(path.join(root, "two.txt"), "utf8"), "two\n");
    assert.equal(
      fs.readdirSync(root).some((name) => /\.bak$|\.tmp$/u.test(name)),
      false
    );
  });

  it("preserves stale transaction backups and requires explicit recovery", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-patch-stale-backup-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "one.txt"), "one\n", "utf8");
    const staleBackup = path.join(root, ".one.txt.patch-stale-backup-0.bak");
    fs.writeFileSync(staleBackup, "recovery evidence\n", "utf8");
    const definition = createWorkspaceWriteToolDefinitions({
      roots: [root],
      maxWriteFileBytes: 1_000_000
    }).find((item) => item.name === "apply_patch");
    const patch = [
      "--- a/one.txt",
      "+++ b/one.txt",
      "@@ -1 +1 @@",
      "-one",
      "+ONE",
      ""
    ].join("\n");

    await assert.rejects(
      () => definition.execute({
        patch,
        expectedSha256: {},
        createDirectories: false,
        dryRun: false
      }, {
        callId: "patch-stale-backup",
        idempotencyKey: "patch-stale-backup"
      }),
      (error) => {
        assert.equal(error.code, "WRITE_TRANSACTION_RECOVERY_REQUIRED");
        assert.equal(error.details.backupPath, staleBackup);
        return true;
      }
    );

    assert.equal(fs.readFileSync(path.join(root, "one.txt"), "utf8"), "one\n");
    assert.equal(fs.readFileSync(staleBackup, "utf8"), "recovery evidence\n");
    assert.equal(
      fs.readdirSync(root).some((name) => name.endsWith(".tmp")),
      false
    );
  });

});
