import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ToolEventStore
} from "../../electron/tools/core/ToolEventStore.js";

import {
  ToolResultStore
} from "../../electron/tools/core/ToolResultStore.js";

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), prefix)
  );
}

test("ToolEventStore bounds its in-memory projection while preserving sequence", () => {
  const store = new ToolEventStore({
    maxMemoryEvents: 100
  });

  for (let index = 0; index < 140; index += 1) {
    store.append({
      type: "diagnostic",
      index
    });
  }

  const info = store.getProjectionInfo();
  assert.equal(store.list().length, 100);
  assert.equal(info.omittedEvents, 40);
  assert.equal(info.lastSequence, 140);
  assert.equal(store.list()[0].index, 40);
});

test("ToolResultStore removes the oldest persisted results when over quota", () => {
  const directory = temporaryDirectory("tool-results-quota-");

  try {
    const store = new ToolResultStore({
      storageDirectory: directory,
      taskId: "task-quota",
      maxInlineBytes: 2000,
      maxStoredBytes: 12000,
      maxPersistedEntries: 2
    });
    const ids = [];

    for (let index = 0; index < 3; index += 1) {
      const captured = store.capture({
        ok: true,
        data: {
          text: `${index}:`.padEnd(5000, String(index))
        }
      });
      ids.push(captured.result.reference.resultId);

      const filePath = path.join(directory, `${ids[index]}.json`);
      const timestamp = new Date(Date.now() + index * 1000);
      fs.utimesSync(filePath, timestamp, timestamp);
    }

    store.enforceQuota();

    assert.equal(store.read(ids[0]).ok, false);
    assert.equal(store.read(ids[1]).ok, true);
    assert.equal(store.read(ids[2]).ok, true);
    assert.equal(
      fs.readdirSync(directory).filter((name) => name.endsWith(".json")).length,
      2
    );
  } finally {
    fs.rmSync(directory, {
      recursive: true,
      force: true
    });
  }
});
