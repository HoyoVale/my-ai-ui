import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { DurableRuntimeJournal } from "../../electron/tools/runtime-state/DurableRuntimeJournal.js";
import { atomicWriteTextFile } from "../../electron/tools/workspace/atomicFileWriter.js";

const EVENT_COUNT = Math.max(
  1_000,
  Number(process.env.TOOL_RUNTIME_BENCHMARK_EVENTS) || 10_000
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-ai-ui-runtime-benchmark-"));
const storageFile = path.join(root, "runtime-journal.jsonl");
const targetFile = path.join(root, "atomic-target.txt");

try {
  const memoryBefore = process.memoryUsage().heapUsed;
  const journal = new DurableRuntimeJournal({
    storageFile,
    taskId: "benchmark-task",
    runId: "benchmark-run",
    durable: false,
    maxFileBytes: 512_000,
    maxArchiveFiles: 64,
    maxTotalBytes: 64 * 1024 * 1024
  });

  const appendStarted = performance.now();
  const pending = [];
  for (let index = 0; index < EVENT_COUNT; index += 1) {
    pending.push(journal.append("TOOL_BENCHMARK_EVENT", {
      index,
      batch: Math.floor(index / 10),
      value: "x".repeat(120)
    }, {
      callId: `call-${index}`,
      durability: "normal"
    }));
  }
  await Promise.all(pending);
  await journal.close();
  const appendMs = performance.now() - appendStarted;
  const storage = journal.storageSnapshot();

  const reloadStarted = performance.now();
  const reopened = new DurableRuntimeJournal({
    storageFile,
    taskId: "benchmark-task",
    runId: "benchmark-run",
    durable: false,
    maxFileBytes: 512_000,
    maxArchiveFiles: 64,
    maxTotalBytes: 64 * 1024 * 1024
  });
  const reloaded = reopened.list();
  const reloadMs = performance.now() - reloadStarted;
  assert.equal(reloaded.length, EVENT_COUNT);
  assert.equal(reopened.cursor().sequence, EVENT_COUNT);

  const writeStarted = performance.now();
  for (let index = 0; index < 100; index += 1) {
    await atomicWriteTextFile({
      targetPath: targetFile,
      content: `version-${index}\n${"payload".repeat(200)}`,
      idempotencyKey: `benchmark-${index}`
    });
  }
  const atomicWriteMs = performance.now() - writeStarted;
  const memoryAfter = process.memoryUsage().heapUsed;
  const memoryDeltaBytes = Math.max(0, memoryAfter - memoryBefore);

  assert.ok(storage.archiveCount > 0);
  assert.ok(storage.archiveBytes + storage.currentBytes <= 64 * 1024 * 1024);
  assert.ok(appendMs < 60_000, `Journal append benchmark too slow: ${appendMs}ms`);
  assert.ok(reloadMs < 15_000, `Journal reload benchmark too slow: ${reloadMs}ms`);
  assert.ok(memoryDeltaBytes < 384 * 1024 * 1024);
  await reopened.close();

  console.log(JSON.stringify({
    eventCount: EVENT_COUNT,
    appendMs: Math.round(appendMs),
    appendEventsPerSecond: Math.round(EVENT_COUNT / (appendMs / 1000)),
    reloadMs: Math.round(reloadMs),
    reloadEventsPerSecond: Math.round(EVENT_COUNT / (reloadMs / 1000)),
    atomicWrites: 100,
    atomicWriteMs: Math.round(atomicWriteMs),
    memoryDeltaBytes,
    storage
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
