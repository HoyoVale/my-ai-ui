import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ToolExecutor
} from "../../electron/tools/core/ToolExecutor.js";
import {
  ToolResultStore
} from "../../electron/tools/core/ToolResultStore.js";

function executor(options = {}) {
  return new ToolExecutor({
    resultStore: new ToolResultStore(),
    maxRetries: 1,
    ...options
  });
}

describe("finite safe Tool retries", () => {
  it("retries one temporary read failure and updates the same record", async () => {
    const updates = [];
    let attempts = 0;
    const runtime = executor({
      onRecord: (record) => updates.push(structuredClone(record))
    });

    const output = await runtime.execute({
      name: "read_demo",
      title: "Read demo",
      sideEffect: "read",
      retryPolicy: {
        maxAttempts: 2,
        retryOn: ["TEMPORARY_FAILURE"],
        backoffMs: 0
      },
      async execute() {
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            error: {
              code: "EAGAIN",
              message: "temporary",
              retryable: true
            }
          };
        }
        return { ok: true, data: { value: 42 } };
      }
    }, {}, { toolCallId: "retry-1" });

    assert.equal(output.ok, true);
    assert.equal(attempts, 2);
    assert.equal(runtime.getRecords().length, 1);
    assert.equal(runtime.getRecords()[0].attempt, 2);
    assert.ok(updates.some((record) => record.status === "retrying"));
  });

  it("does not retry permission failures", async () => {
    let attempts = 0;
    const runtime = executor();
    const output = await runtime.execute({
      name: "permission_demo",
      title: "Permission demo",
      sideEffect: "read",
      retryPolicy: {
        maxAttempts: 2,
        retryOn: ["TEMPORARY_FAILURE"]
      },
      async execute() {
        attempts += 1;
        return {
          ok: false,
          error: {
            code: "EACCES",
            message: "denied",
            retryable: true
          }
        };
      }
    }, {}, { toolCallId: "permission-1" });

    assert.equal(attempts, 1);
    assert.equal(output.error.type, "PERMISSION_DENIED");
  });

  it("cancels even when a Tool promise never settles", async () => {
    const controller = new AbortController();
    const runtime = executor({
      context: { abortSignal: controller.signal }
    });

    const pending = runtime.execute({
      name: "hanging_demo",
      title: "Hanging demo",
      sideEffect: "read",
      timeoutMs: 10000,
      async execute() {
        return new Promise(() => {});
      }
    }, {}, { toolCallId: "hanging-1" });

    setTimeout(() => controller.abort("user-stop"), 10);
    const output = await pending;

    assert.equal(output.error.type, "CANCELLED");
    assert.equal(runtime.getRecords()[0].status, "cancelled");
  });
});
