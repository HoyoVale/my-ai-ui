import assert from "node:assert/strict";
import test from "node:test";

import {
  RunLifecycleCoordinator,
  RUN_LIFECYCLE_STATES
} from "../../electron/agent/RunLifecycleCoordinator.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("RunLifecycleCoordinator grants one settlement owner and shares the result", async () => {
  const lifecycle = new RunLifecycleCoordinator({ runId: "run-1" });
  const first = lifecycle.beginSettlement("completed");
  const second = lifecycle.beginSettlement("cancelled");

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.source, "completed");

  const result = { outcome: "completed" };
  assert.equal(lifecycle.completeSettlement(first.token, result), true);
  assert.equal(lifecycle.completeSettlement(first.token, result), false);
  assert.deepEqual(await second.promise, result);
  assert.equal(lifecycle.snapshot().state, RUN_LIFECYCLE_STATES.SETTLED);
});

test("RunLifecycleCoordinator disposes resources once in priority order", async () => {
  const lifecycle = new RunLifecycleCoordinator({ runId: "run-2" });
  const calls = [];

  lifecycle.registerResource("tool-session", async () => {
    calls.push("tool-session");
  }, { priority: 50 });
  lifecycle.registerResource("approval-controller", () => {
    calls.push("approval-controller");
  }, { priority: 100 });

  const [first, second] = await Promise.all([
    lifecycle.dispose("terminal"),
    lifecycle.dispose("duplicate")
  ]);

  assert.deepEqual(calls, ["approval-controller", "tool-session"]);
  assert.deepEqual(first.map((item) => item.ok), [true, true]);
  assert.deepEqual(second, first);
  assert.equal(lifecycle.snapshot().state, RUN_LIFECYCLE_STATES.DISPOSED);
});

test("RunLifecycleCoordinator bounds cleanup and releases late resources", async () => {
  const lifecycle = new RunLifecycleCoordinator({
    runId: "run-3",
    cleanupTimeoutMs: 15
  });
  let lateCleanupCount = 0;

  lifecycle.registerResource("hung", () => new Promise(() => {}), {
    priority: 10,
    timeoutMs: 10
  });

  const results = await lifecycle.dispose("shutdown");
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error.code, "RUN_RESOURCE_CLEANUP_TIMEOUT");

  const accepted = lifecycle.registerResource("late", async () => {
    lateCleanupCount += 1;
  });
  assert.equal(accepted, false);
  await delay(0);
  assert.equal(lateCleanupCount, 1);
});
