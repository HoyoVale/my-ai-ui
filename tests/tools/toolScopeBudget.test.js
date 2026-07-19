import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import { z } from "zod";

import {
  ToolExecutor
} from "../../electron/tools/core/ToolExecutor.js";

function definition() {
  return {
    name: "scope_demo",
    title: "Scope demo",
    inputSchema: z.object({ value: z.number() }),
    countsTowardLimit: false,
    countsTowardRepeatLimit: false,
    sideEffect: "none",
    riskLevel: "none",
    async execute(input) {
      return {
        ok: true,
        data: input
      };
    }
  };
}

describe("per-step and per-batch Tool boundaries", () => {
  it("limits one model step even for otherwise unmetered tools", async () => {
    const executor = new ToolExecutor({
      maxToolCalls: 100,
      maxTotalToolCalls: 100,
      maxToolCallsPerStep: 2,
      maxToolCallsPerBatch: 10
    });

    executor.beginStep({
      stepId: "segment-1:step-1",
      segmentId: "segment-1"
    });

    const first = await executor.execute(
      definition(),
      { value: 1 },
      { metadata: { batch: { id: "batch-1" } } }
    );
    const second = await executor.execute(
      definition(),
      { value: 2 },
      { metadata: { batch: { id: "batch-1" } } }
    );
    const third = await executor.execute(
      definition(),
      { value: 3 },
      { metadata: { batch: { id: "batch-1" } } }
    );
    const fourth = await executor.execute(
      definition(),
      { value: 4 },
      { metadata: { batch: { id: "batch-1" } } }
    );

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(third.error.code, "TOOL_STEP_LIMIT");
    assert.equal(fourth.error.code, "TOOL_STEP_LIMIT");
    assert.equal(third.error.category, "budget_exceeded");
    assert.equal(executor.getRecords().length, 3);
  });

  it("keeps a batch boundary across multiple model steps", async () => {
    const executor = new ToolExecutor({
      maxToolCalls: 100,
      maxTotalToolCalls: 100,
      maxToolCallsPerStep: 10,
      maxToolCallsPerBatch: 2
    });
    const options = {
      metadata: {
        batch: {
          id: "shared-batch"
        }
      }
    };

    executor.beginStep({ stepId: "step-1" });
    await executor.execute(definition(), { value: 1 }, options);
    executor.endStep("step-1");

    executor.beginStep({ stepId: "step-2" });
    const second = await executor.execute(
      definition(),
      { value: 2 },
      options
    );
    const third = await executor.execute(
      definition(),
      { value: 3 },
      options
    );

    assert.equal(second.ok, true);
    assert.equal(third.error.code, "TOOL_BATCH_LIMIT");
  });
});
