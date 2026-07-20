import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DurableRuntimeJournal
} from "../../electron/tools/runtime-state/DurableRuntimeJournal.js";

function temporaryFile() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "my-ai-ui-journal-v2-")
  );
  return path.join(directory, "runtime-journal.jsonl");
}

test("migrates V1 Journal events to the checksummed V2 schema", () => {
  const file = temporaryFile();
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    sequence: 4,
    timestamp: 100,
    taskId: "task-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    segmentId: "segment-1",
    callId: "call-1",
    type: "TOOL_DISPATCHED",
    payload: { toolName: "read_file" }
  })}\n`, "utf8");

  const journal = new DurableRuntimeJournal({ storageFile: file });
  const event = journal.list()[0];

  assert.equal(event.version, 2);
  assert.equal(event.sequence, 4);
  assert.equal(event.actor, "runtime");
  assert.equal(event.durability, "critical");
  assert.equal(event.integrity.algorithm, "sha256");
  assert.equal(event.integrity.checksum.length, 64);
  assert.equal(journal.loadReport.migrated, 1);
  assert.equal(journal.cursor().sequence, 4);
});

test("skips a V2 Journal event whose checksum no longer matches", () => {
  const file = temporaryFile();
  const journal = new DurableRuntimeJournal({
    storageFile: file,
    taskId: "task-1"
  });
  return journal.append("RUN_STARTED", { objective: "original" })
    .then(() => journal.close())
    .then(() => {
      const event = JSON.parse(fs.readFileSync(file, "utf8").trim());
      event.payload.objective = "tampered";
      fs.writeFileSync(file, `${JSON.stringify(event)}\n`, "utf8");

      const recovered = new DurableRuntimeJournal({ storageFile: file });
      assert.equal(recovered.list().length, 0);
      assert.equal(recovered.loadReport.skipped, 1);
    });
});
