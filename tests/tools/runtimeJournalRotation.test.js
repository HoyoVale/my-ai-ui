import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DurableRuntimeJournal } from "../../electron/tools/runtime-state/DurableRuntimeJournal.js";
import { ToolExecutionLedger } from "../../electron/tools/runtime-state/ToolExecutionLedger.js";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("DurableRuntimeJournal rolling storage", () => {
  it("rotates files, preserves sequence, and reloads across archives", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-journal-roll-"));
    roots.push(root);
    const storageFile = path.join(root, "runtime-journal.jsonl");
    const journal = new DurableRuntimeJournal({
      storageFile,
      taskId: "task-roll",
      runId: "run-roll",
      maxFileBytes: 64_000,
      maxArchiveFiles: 8,
      maxTotalBytes: 1_000_000
    });

    for (let index = 0; index < 900; index += 1) {
      await journal.append("TOOL_DIAGNOSTIC", {
        index,
        value: "x".repeat(180)
      }, { durability: "normal" });
    }
    await journal.close();

    const snapshot = journal.storageSnapshot();
    assert.ok(snapshot.archiveCount > 0);
    assert.ok(snapshot.currentBytes <= 64_000 + 2_000);
    assert.equal(journal.cursor().sequence, 900);

    const reopened = new DurableRuntimeJournal({
      storageFile,
      taskId: "task-roll",
      runId: "run-roll",
      maxFileBytes: 64_000,
      maxArchiveFiles: 8,
      maxTotalBytes: 1_000_000
    });
    assert.equal(reopened.list().length, 900);
    assert.equal(reopened.cursor().sequence, 900);
    await reopened.close();
  });

  it("removes oldest archives when count or total quota is exceeded", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-journal-quota-"));
    roots.push(root);
    const storageFile = path.join(root, "runtime-journal.jsonl");
    const journal = new DurableRuntimeJournal({
      storageFile,
      maxFileBytes: 64_000,
      maxArchiveFiles: 2,
      maxTotalBytes: 170_000
    });

    for (let index = 0; index < 1600; index += 1) {
      await journal.append("TOOL_DIAGNOSTIC", {
        index,
        value: "q".repeat(220)
      }, { durability: "normal" });
    }
    await journal.close();

    const snapshot = journal.storageSnapshot();
    assert.ok(snapshot.archiveCount <= 2);
    assert.ok(snapshot.archiveBytes + snapshot.currentBytes <= 190_000);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "runtime-journal.manifest.json"), "utf8")
    );
    assert.equal(manifest.archives.length, snapshot.archiveCount);
  });
});

it("preserves unresolved call state after Journal quota prunes its original events", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xixi-journal-call-snapshot-"));
  roots.push(root);
  const definition = {
    id: "snapshot-write",
    name: "snapshot_write",
    idempotency: "natural",
    runtimeContract: {
      effect: "local_write",
      retryMode: "idempotency_key",
      supportsAbort: true,
      supportsResume: true,
      leaseTtlMs: 60_000
    }
  };
  const first = new ToolExecutionLedger({
    directory: root,
    taskId: "task-snapshot",
    runId: "run-snapshot",
    workspaceId: "workspace-snapshot",
    ownerId: "snapshot-owner-1",
    journalOptions: {
      maxFileBytes: 64_000,
      maxArchiveFiles: 1,
      maxTotalBytes: 80_000
    }
  });
  const prepared = await first.prepare({
    definition,
    input: { path: "important.txt", content: "recover me" },
    callId: "call-snapshot"
  });
  await first.markDispatched(prepared.call);
  for (let index = 0; index < 1_200; index += 1) {
    await first.recordRuntimeEvent("TOOL_NOISE", {
      index,
      payload: "n".repeat(220)
    });
  }
  await first.close();

  const second = new ToolExecutionLedger({
    directory: root,
    taskId: "task-snapshot",
    runId: "run-recovered",
    workspaceId: "workspace-snapshot",
    ownerId: "snapshot-owner-2",
    journalOptions: {
      maxFileBytes: 64_000,
      maxArchiveFiles: 1,
      maxTotalBytes: 80_000
    }
  });
  const recovered = second.developerSnapshot().calls.find(
    (call) => call.callId === "call-snapshot"
  );
  const internal = second.calls.get("call-snapshot");

  assert.equal(recovered.state, "dispatched");
  assert.equal(recovered.recovery, "retry_with_idempotency_key");
  assert.deepEqual(internal.input, {
    path: "important.txt",
    content: "recover me"
  });
  assert.equal(
    second.journal.list().some((event) =>
      event.callId === "call-snapshot" && event.type === "TOOL_PREPARED"
    ),
    false
  );
  await second.close();
});
