import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  ToolExecutor
} from "../../electron/tools/core/ToolExecutor.js";

import {
  ToolResultStore
} from "../../electron/tools/core/ToolResultStore.js";

describe("tool lifecycle", () => {
  it("emits queued, running and completed updates for one record", async () => {
    const updates = [];
    const executor = new ToolExecutor({
      onRecord: (record) => {
        updates.push(structuredClone(record));
      },
      resultStore: new ToolResultStore()
    });

    const result = await executor.execute(
      {
        name: "demo_tool",
        title: "Demo tool",
        async execute(input) {
          return {
            value: input.value
          };
        }
      },
      { value: 42 },
      { toolCallId: "call-1" }
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      updates.map((record) => record.status),
      ["queued", "running", "completed"]
    );
    assert.equal(
      updates.every((record) => record.id === "call-1"),
      true
    );
    assert.equal(executor.getRecords().length, 1);
    assert.equal(
      executor.getRecords()[0].result.status,
      "success"
    );
  });

  it("records cancellation as a canonical cancelled lifecycle state", async () => {
    const controller = new AbortController();
    controller.abort("user-stop");
    const executor = new ToolExecutor({
      context: {
        abortSignal: controller.signal
      },
      resultStore: new ToolResultStore()
    });

    const output = await executor.execute(
      {
        name: "cancelled_tool",
        title: "Cancelled tool",
        async execute() {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
      },
      {},
      { toolCallId: "call-cancel" }
    );

    const record = executor.getRecords()[0];

    assert.equal(output.error.code, "CANCELLED_BY_USER");
    assert.equal(record.status, "cancelled");
    assert.equal(record.result.status, "cancelled");
  });
});
