import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  CoalescedStatusBroadcaster
} from "../../electron/agent/CoalescedStatusBroadcaster.js";
import {
  RunLifecycleCoordinator
} from "../../electron/agent/RunLifecycleCoordinator.js";
import {
  AsyncPersistenceQueue,
  flushAllPersistenceQueues,
  persistenceQueueRegistrySnapshot
} from "../../electron/persistence/AsyncPersistenceQueue.js";
import {
  ResponseStreamReplayBuffer
} from "../../electron/windows/response/ResponseStreamReplayBuffer.js";
import {
  SubprocessSupervisor
} from "../../electron/tools/process/SubprocessSupervisor.js";

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RESPONSE_CHANNELS = Object.freeze({
  STREAM_START: "start",
  STREAM_CHUNK: "chunk",
  STREAM_REPLACE: "replace",
  STREAM_END: "end",
  STREAM_CLEAR: "clear"
});

test("settlement failure is observable without an unhandled rejection race", async () => {
  const lifecycle = new RunLifecycleCoordinator({ runId: "failure-race" });
  const claim = lifecycle.beginSettlement("fault-injection");
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);

  try {
    const error = new Error("injected settlement failure");
    assert.equal(lifecycle.failSettlement(claim.token, error), true);
    await delay(0);
    assert.deepEqual(unhandled, []);
    await assert.rejects(
      lifecycle.waitForSettlement(),
      /injected settlement failure/u
    );
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

test("hundreds of simultaneous terminal exits produce one owner and one cleanup", async () => {
  const lifecycle = new RunLifecycleCoordinator({ runId: "settlement-stress" });
  let cleanupCount = 0;
  lifecycle.registerResource("resource", async () => {
    cleanupCount += 1;
  });

  const claims = await Promise.all(
    Array.from({ length: 500 }, async (_, index) => (
      lifecycle.beginSettlement(`exit-${index}`)
    ))
  );
  const owner = claims.find((claim) => claim.accepted);
  assert.ok(owner);
  assert.equal(claims.filter((claim) => claim.accepted).length, 1);

  const result = { outcome: "completed" };
  lifecycle.completeSettlement(owner.token, result);
  await Promise.all(claims.map((claim) => claim.promise));
  await Promise.all(Array.from({ length: 50 }, () => lifecycle.dispose("race")));

  const snapshot = lifecycle.snapshot();
  assert.equal(cleanupCount, 1);
  assert.equal(snapshot.settlementAttemptCount, 500);
  assert.equal(snapshot.duplicateSettlementCount, 499);
  assert.equal(snapshot.cleanupResults.length, 1);
});

test("status broadcasting isolates async renderer failures and coalesces while busy", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const errors = [];
  let publishes = 0;
  const broadcaster = new CoalescedStatusBroadcaster({
    intervalMs: 0,
    onError: (error) => errors.push(error.message),
    publish: async () => {
      publishes += 1;
      if (publishes === 1) {
        await firstGate;
        throw new Error("renderer closed");
      }
    }
  });

  broadcaster.schedule({ immediate: true });
  for (let index = 0; index < 1000; index += 1) {
    broadcaster.schedule({ immediate: true });
  }
  assert.equal(publishes, 1);

  releaseFirst();
  await broadcaster.waitForIdle();
  await delay(0);
  await broadcaster.waitForIdle();

  assert.equal(publishes, 2);
  assert.deepEqual(errors, ["renderer closed"]);
  assert.equal(broadcaster.snapshot().errorCount, 1);
  broadcaster.close({ flush: false });
});

test("global persistence flush is bounded when a disk write hangs", async () => {
  let releaseWrite;
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  const queue = new AsyncPersistenceQueue({
    delayMs: 0,
    onError: () => {},
    write: async () => {
      await writeGate;
    }
  });
  queue.enqueue({ revision: 1 }, { immediate: true });
  await delay(0);

  const startedAt = Date.now();
  const stalled = await flushAllPersistenceQueues({
    maxAttempts: 2,
    retryDelayMs: 0,
    attemptTimeoutMs: 20
  });
  const durationMs = Date.now() - startedAt;

  assert.equal(stalled.ok, false);
  assert.equal(stalled.pendingCount >= 1, true);
  assert.equal(stalled.timedOutCount >= 1, true);
  assert.equal(durationMs < 250, true);

  releaseWrite();
  await queue.flush();
  assert.equal(await queue.close(), true);
  assert.equal(persistenceQueueRegistrySnapshot().pendingCount, 0);
});

test("response replay remains bounded across ten thousand chunks and renderer reloads", () => {
  const replay = new ResponseStreamReplayBuffer({
    maxTextLength: 100_000
  });
  replay.start();
  for (let index = 0; index < 10_000; index += 1) {
    replay.append(`${index},`);
  }
  replay.end();

  for (let reload = 0; reload < 100; reload += 1) {
    const messages = replay.replayMessages(RESPONSE_CHANNELS);
    assert.equal(messages.length, 3);
    assert.equal(messages[0].channel, RESPONSE_CHANNELS.STREAM_START);
    assert.equal(messages[1].channel, RESPONSE_CHANNELS.STREAM_REPLACE);
    assert.equal(messages[2].channel, RESPONSE_CHANNELS.STREAM_END);
  }

  const snapshot = replay.snapshot();
  assert.equal(snapshot.textLength <= 100_000, true);
  assert.equal(snapshot.state, "ended");
});

test("response replay clear discards stale content before the next renderer", () => {
  const replay = new ResponseStreamReplayBuffer();
  replay.start();
  replay.append("stale response");
  replay.clear();

  assert.deepEqual(replay.replayMessages(RESPONSE_CHANNELS), [
    { channel: RESPONSE_CHANNELS.STREAM_CLEAR, args: [] }
  ]);
});

test("subprocess abort cannot be lost between spawn and listener attachment", async () => {
  const controller = new AbortController();
  const supervisor = new SubprocessSupervisor({
    defaultTimeoutMs: 5000,
    terminationGraceMs: 10,
    spawnProcess(command, args, options) {
      const child = spawn(command, args, options);
      controller.abort("spawn-race");
      return child;
    }
  });

  const result = await supervisor.run(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { abortSignal: controller.signal }
  );

  assert.equal(result.terminated, true);
  assert.equal(result.terminationReason, "abort");
  assert.equal(supervisor.snapshot().running.length, 0);
});

test("repeated terminateAll calls keep one shutdown reason and leave no children", async () => {
  const supervisor = new SubprocessSupervisor({
    defaultTimeoutMs: 5000,
    terminationGraceMs: 10
  });
  const execution = supervisor.run(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"]
  );

  while (supervisor.snapshot().running.length === 0) {
    await delay(1);
  }
  await Promise.all([
    supervisor.terminateAll("shutdown-fault"),
    supervisor.terminateAll("duplicate-shutdown"),
    supervisor.terminateAll("duplicate-shutdown-2")
  ]);
  const result = await execution;

  assert.equal(result.terminated, true);
  assert.equal(result.terminationReason, "shutdown-fault");
  assert.equal(supervisor.snapshot().running.length, 0);
});
