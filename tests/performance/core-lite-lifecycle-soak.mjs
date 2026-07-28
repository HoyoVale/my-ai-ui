import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

function numericArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
  return String(raw ?? fallback).trim();
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: String(error.name ?? "Error"),
    message: String(error.message ?? error),
    code: error.code == null ? null : String(error.code),
    stack: String(error.stack ?? "").slice(0, 20_000)
  };
}

function writeReport(filePath, value) {
  if (!filePath) return;
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, absolutePath);
}

const seconds = numericArg("seconds", 60);
const reportPath = stringArg(
  "report",
  process.env.CORE_LITE_STRESS_REPORT ?? ""
);
const runStartedAt = Date.now();
const runStartedIso = new Date(runStartedAt).toISOString();
const maxIterations = Math.max(1, Math.round(numericArg("iterations", 20_000)));
const subprocessEvery = Math.max(1, Math.round(numericArg("subprocess-every", 250)));
const deadline = Date.now() + seconds * 1000;
const memoryStart = process.memoryUsage().heapUsed;
const persistenceWrites = [];
let persistenceAttempts = 0;
let iterations = 0;
let subprocesses = 0;
let broadcasts = 0;
let injectedBroadcastErrors = 0;
let cleanupFailures = 0;

const persistence = new AsyncPersistenceQueue({
  delayMs: 2,
  maxWriteRetries: 1,
  onError: (error) => {
    throw error;
  },
  write: async (value) => {
    persistenceAttempts += 1;
    if (persistenceAttempts % 97 === 1) {
      throw new Error("injected transient persistence failure");
    }
    await delay(1);
    persistenceWrites.push(value);
  }
});

try {
  while (iterations < maxIterations && Date.now() < deadline) {
    const lifecycle = new RunLifecycleCoordinator({
      runId: `soak-${iterations}`,
      cleanupTimeoutMs: 25
    });
    let cleanupCount = 0;
    lifecycle.registerResource("approval", () => {
      cleanupCount += 1;
    }, { priority: 100 });
    lifecycle.registerResource("tool-session", async () => {
      cleanupCount += 1;
      if (iterations % 211 === 0) {
        throw new Error("injected cleanup failure");
      }
    }, { priority: 50 });

    const claims = Array.from({ length: 16 }, (_, index) => (
      lifecycle.beginSettlement(`source-${index}`)
    ));
    const owner = claims.find((claim) => claim.accepted);
    assert.ok(owner);
    lifecycle.completeSettlement(owner.token, {
      outcome: iterations % 2 === 0 ? "completed" : "cancelled"
    });
    await Promise.all(claims.map((claim) => claim.promise));
    const cleanup = await Promise.all([
      lifecycle.dispose("soak"),
      lifecycle.dispose("duplicate"),
      lifecycle.dispose("duplicate-2")
    ]);
    assert.equal(cleanupCount, 2);
    cleanupFailures += cleanup[0].filter((result) => !result.ok).length;

    const replay = new ResponseStreamReplayBuffer({ maxTextLength: 100_000 });
    replay.start();
    for (let chunk = 0; chunk < 32; chunk += 1) {
      replay.append(`iteration=${iterations};chunk=${chunk}\n`);
    }
    replay.end();
    assert.equal(replay.replayMessages({
      STREAM_START: "start",
      STREAM_CHUNK: "chunk",
      STREAM_REPLACE: "replace",
      STREAM_END: "end",
      STREAM_CLEAR: "clear"
    }).length, 3);

    const broadcaster = new CoalescedStatusBroadcaster({
      intervalMs: 0,
      onError: () => {
        injectedBroadcastErrors += 1;
      },
      publish: async () => {
        broadcasts += 1;
        if (iterations % 173 === 0) {
          throw new Error("injected renderer close");
        }
      }
    });
    for (let update = 0; update < 100; update += 1) {
      broadcaster.schedule({ immediate: true });
    }
    await broadcaster.waitForIdle();
    broadcaster.close({ flush: false });

    persistence.enqueue({ iteration: iterations });

    if (iterations % subprocessEvery === 0) {
      const supervisor = new SubprocessSupervisor({
        defaultTimeoutMs: 2000,
        terminationGraceMs: 20
      });
      const controller = new AbortController();
      const execution = supervisor.run(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { abortSignal: controller.signal }
      );
      controller.abort("soak-cancel");
      const result = await execution;
      assert.equal(result.terminated, true);
      assert.equal(supervisor.snapshot().running.length, 0);
      subprocesses += 1;
    }

    iterations += 1;
    if (iterations % 100 === 0) {
      await delay(0);
    }
  }

  persistence.enqueue({ iteration: iterations, final: true }, { immediate: true });
  const flush = await flushAllPersistenceQueues({
    maxAttempts: 3,
    retryDelayMs: 5,
    attemptTimeoutMs: 1000
  });
  assert.equal(flush.ok, true);
  assert.equal(await persistence.close(), true);
  assert.equal(persistenceQueueRegistrySnapshot().pendingCount, 0);

  const memoryDeltaBytes = Math.max(
    0,
    process.memoryUsage().heapUsed - memoryStart
  );
  assert.equal(iterations > 0, true);
  assert.equal(memoryDeltaBytes < 256 * 1024 * 1024, true);

  const summary = {
    schemaVersion: 1,
    suite: "core-lite-lifecycle-soak",
    status: "passed",
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    startedAt: runStartedIso,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - runStartedAt,
    requestedSeconds: seconds,
    iterations,
    subprocesses,
    broadcasts,
    injectedBroadcastErrors,
    cleanupFailures,
    persistenceAttempts,
    persistenceWrites: persistenceWrites.length,
    memoryDeltaBytes,
    error: null
  };
  writeReport(reportPath, summary);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  writeReport(reportPath, {
    schemaVersion: 1,
    suite: "core-lite-lifecycle-soak",
    status: "failed",
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    startedAt: runStartedIso,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - runStartedAt,
    requestedSeconds: seconds,
    iterations,
    subprocesses,
    broadcasts,
    injectedBroadcastErrors,
    cleanupFailures,
    persistenceAttempts,
    persistenceWrites: persistenceWrites.length,
    error: serializeError(error)
  });
  throw error;
} finally {
  await persistence.close().catch(() => false);
}
