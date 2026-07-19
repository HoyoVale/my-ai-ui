import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  AsyncPersistenceQueue
} from "../../electron/persistence/AsyncPersistenceQueue.js";

describe("AsyncPersistenceQueue", () => {
  it("coalesces high-frequency snapshots and flushes the newest value", async () => {
    const writes = [];
    const queue = new AsyncPersistenceQueue({
      delayMs: 1000,
      write: async (value) => {
        writes.push(value);
      }
    });

    queue.enqueue({ revision: 1 });
    queue.enqueue({ revision: 2 });
    queue.enqueue({ revision: 3 });

    assert.deepEqual(writes, []);

    await queue.flush();

    assert.deepEqual(writes, [
      { revision: 3 }
    ]);
    await queue.close();
  });

  it("serializes a snapshot queued while an earlier write is running", async () => {
    const writes = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const queue = new AsyncPersistenceQueue({
      delayMs: 0,
      write: async (value) => {
        writes.push(value);
        if (value === "first") {
          await firstGate;
        }
      }
    });

    queue.enqueue("first", { immediate: true });
    await Promise.resolve();
    queue.enqueue("second", { immediate: true });
    releaseFirst();
    await queue.flush();

    assert.deepEqual(writes, ["first", "second"]);
    await queue.close();
  });
});
