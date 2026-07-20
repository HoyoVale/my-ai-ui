import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { DurableRuntimeJournal } from "../../electron/tools/runtime-state/DurableRuntimeJournal.js";
import { atomicWriteTextFile } from "../../electron/tools/workspace/atomicFileWriter.js";

const minutes = Math.max(
  0.02,
  Number(process.env.TOOL_RUNTIME_SOAK_MINUTES) || 30
);
const durationMs = minutes * 60_000;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-ai-ui-runtime-soak-"));
const storageFile = path.join(root, "runtime-journal.jsonl");
const targetFile = path.join(root, "soak-state.txt");
const maxFileBytes = 128_000;
const maxArchiveFiles = 4;
const maxTotalBytes = 640_000;

try {
  const journal = new DurableRuntimeJournal({
    storageFile,
    taskId: "soak-task",
    runId: "soak-run",
    durable: false,
    maxFileBytes,
    maxArchiveFiles,
    maxTotalBytes
  });
  const startedAt = Date.now();
  const memoryStart = process.memoryUsage().heapUsed;
  let events = 0;
  let writes = 0;

  while (Date.now() - startedAt < durationMs) {
    const batch = [];
    for (let index = 0; index < 20; index += 1) {
      const sequence = events + index;
      batch.push(journal.append("TOOL_SOAK_EVENT", {
        sequence,
        payload: "s".repeat(160)
      }, {
        callId: `soak-${sequence}`,
        durability: sequence % 200 === 0 ? "critical" : "normal"
      }));
    }
    await Promise.all(batch);
    events += batch.length;

    await atomicWriteTextFile({
      targetPath: targetFile,
      content: `events=${events}\nwrites=${writes + 1}\n`,
      idempotencyKey: `soak-write-${writes + 1}`
    });
    writes += 1;
    await delay(100);
  }

  await journal.close();
  const storage = journal.storageSnapshot();
  const totalBytes = storage.currentBytes + storage.archiveBytes;
  const temporaryFiles = fs.readdirSync(root).filter((name) => name.endsWith(".tmp"));
  const memoryDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - memoryStart);

  assert.ok(events > 0);
  assert.ok(writes > 0);
  assert.ok(storage.archiveCount <= maxArchiveFiles);
  assert.ok(totalBytes <= maxTotalBytes + maxFileBytes);
  assert.deepEqual(temporaryFiles, []);
  assert.ok(memoryDeltaBytes < 512 * 1024 * 1024);
  assert.match(fs.readFileSync(targetFile, "utf8"), /^events=\d+/u);

  console.log(JSON.stringify({
    requestedMinutes: minutes,
    actualDurationMs: Date.now() - startedAt,
    events,
    writes,
    memoryDeltaBytes,
    storage
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
