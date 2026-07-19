import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  AsyncPersistenceQueue,
  flushAllPersistenceQueues
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

it("keeps a failed final write pending until a later close succeeds", async () => {
  const writes = [];
  const errors = [];
  let shouldFail = true;
  const queue = new AsyncPersistenceQueue({
    delayMs: 1000,
    maxWriteRetries: 0,
    onError: (error) => {
      errors.push(error.message);
    },
    write: async (value) => {
      if (shouldFail) {
        throw new Error("disk unavailable");
      }
      writes.push(value);
    }
  });

  queue.enqueue({ revision: 1 });

  assert.equal(await queue.close(), false);
  assert.deepEqual(errors, ["disk unavailable"]);
  assert.deepEqual(writes, []);

  shouldFail = false;

  assert.equal(await queue.close(), true);
  assert.deepEqual(writes, [{ revision: 1 }]);
});


it("retries temporarily failed queues during the global shutdown flush", async () => {
  const writes = [];
  let attempts = 0;
  const queue = new AsyncPersistenceQueue({
    delayMs: 1000,
    maxWriteRetries: 0,
    onError: () => {},
    write: async (value) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary failure");
      }
      writes.push(value);
    }
  });

  queue.enqueue("checkpoint");

  const result = await flushAllPersistenceQueues({
    maxAttempts: 2,
    retryDelayMs: 0
  });

  assert.deepEqual(result, {
    ok: true,
    pendingCount: 0
  });
  assert.deepEqual(writes, ["checkpoint"]);
  assert.equal(await queue.close(), true);
});
