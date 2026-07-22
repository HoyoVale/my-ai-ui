import assert from "node:assert/strict";
import { it } from "node:test";

import {
  ToolConcurrencyGuard
} from "../../electron/tools/core/ToolConcurrencyGuard.js";

it("runs exclusive Plan control work without overlapping ordinary tools", async () => {
  const guard = new ToolConcurrencyGuard({ maxConcurrent: 4 });
  const releaseReadOne = await guard.acquire("read:one");
  const releaseReadTwo = await guard.acquire("read:two");
  let planStarted = false;
  const planPromise = guard.acquire("control:goal-plan", null, {
    exclusive: true
  }).then((release) => {
    planStarted = true;
    return release;
  });

  await Promise.resolve();
  assert.equal(planStarted, false);
  releaseReadOne();
  await Promise.resolve();
  assert.equal(planStarted, false);
  releaseReadTwo();
  const releasePlan = await planPromise;
  assert.equal(planStarted, true);

  let laterReadStarted = false;
  const laterReadPromise = guard.acquire("read:later").then((release) => {
    laterReadStarted = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(laterReadStarted, false);

  releasePlan();
  const releaseLaterRead = await laterReadPromise;
  assert.equal(laterReadStarted, true);
  releaseLaterRead();
});

it("does not let later ordinary tools jump ahead of a queued Plan control operation", async () => {
  const guard = new ToolConcurrencyGuard({ maxConcurrent: 4 });
  const releaseActiveRead = await guard.acquire("read:active");
  const order = [];

  const planPromise = guard.acquire("control:goal-plan", null, {
    exclusive: true
  }).then((release) => {
    order.push("plan");
    return release;
  });
  const laterReadPromise = guard.acquire("read:later").then((release) => {
    order.push("read");
    return release;
  });

  await Promise.resolve();
  assert.deepEqual(order, []);
  releaseActiveRead();

  const releasePlan = await planPromise;
  assert.deepEqual(order, ["plan"]);
  releasePlan();

  const releaseLaterRead = await laterReadPromise;
  assert.deepEqual(order, ["plan", "read"]);
  releaseLaterRead();
});
