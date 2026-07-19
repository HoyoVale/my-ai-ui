import assert from "node:assert/strict";
import test from "node:test";

import {
  CoalescedStatusBroadcaster
} from "../../electron/agent/CoalescedStatusBroadcaster.js";

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

test("coalesces rapid status updates into one publish", async () => {
  let count = 0;
  const broadcaster = new CoalescedStatusBroadcaster({
    intervalMs: 15,
    publish: () => {
      count += 1;
    }
  });

  broadcaster.schedule();
  broadcaster.schedule();
  broadcaster.schedule();

  await wait(30);
  assert.equal(count, 1);
  broadcaster.close();
});

test("publishes terminal snapshots immediately", () => {
  let count = 0;
  const broadcaster = new CoalescedStatusBroadcaster({
    intervalMs: 1000,
    publish: () => {
      count += 1;
    }
  });

  broadcaster.schedule();
  broadcaster.schedule({ immediate: true });

  assert.equal(count, 1);
  broadcaster.close();
});
