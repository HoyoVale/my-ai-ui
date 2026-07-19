import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  createFinalizationBudget
} from "../../electron/agent/finalizationBudget.js";

describe("finalization time budget", () => {
  it("uses one independent deadline across all attempts", () => {
    let now = 1000;
    const budget = createFinalizationBudget({
      timeoutMs: 30000,
      now: () => now
    });

    assert.deepEqual(
      budget.timeoutFor(120000),
      {
        totalMs: 30000,
        chunkMs: 15000
      }
    );

    now += 22000;

    assert.deepEqual(
      budget.timeoutFor(120000),
      {
        totalMs: 8000,
        chunkMs: 8000
      }
    );
    assert.equal(budget.remainingMs(), 8000);
  });
});
