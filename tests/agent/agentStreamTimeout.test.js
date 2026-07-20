import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentStreamTimeout
} from "../../electron/agent/agentStreamTimeout.js";

test("interactive Tool approval is not cut off by the model timeout", () => {
  const timeout = createAgentStreamTimeout({
    modelTimeoutMs: 120_000,
    remainingRunMs: 1_800_000,
    approvalTimeoutMs: 300_000,
    defaultToolTimeoutMs: 15_000,
    hasApprovalGatedTools: true
  });

  assert.equal(timeout.totalMs, 1_800_000);
  assert.equal(timeout.toolMs, 320_000);
  assert.equal(timeout.chunkMs, 320_000);
  assert.ok(timeout.chunkMs > 120_000);
});

test("read-only runs keep the short stalled-stream timeout", () => {
  const timeout = createAgentStreamTimeout({
    modelTimeoutMs: 120_000,
    remainingRunMs: 1_800_000,
    hasApprovalGatedTools: false
  });

  assert.equal(timeout.totalMs, 120_000);
  assert.equal(timeout.chunkMs, 45_000);
  assert.equal(timeout.toolMs, 20_000);
});
