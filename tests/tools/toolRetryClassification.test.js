import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TOOL_ERROR_TYPES,
  classifyToolError,
  shouldRetryToolError,
  toolRetryDelayMs
} from "../../electron/tools/core/toolErrors.js";

describe("Tool retry classification", () => {
  it("uses the Run signal rather than an arbitrary AbortError as cancellation authority", () => {
    const providerAbort = new Error("internal abort");
    providerAbort.name = "AbortError";
    const internal = classifyToolError(providerAbort);
    assert.notEqual(internal.type, TOOL_ERROR_TYPES.CANCELLED);

    const controller = new AbortController();
    controller.abort("user-stop");
    const cancelled = classifyToolError(providerAbort, {
      abortSignal: controller.signal
    });
    assert.equal(cancelled.type, TOOL_ERROR_TYPES.CANCELLED);
    assert.equal(cancelled.retryable, false);
  });

  it("retries rate limits only when the Tool policy allows it", () => {
    const classified = classifyToolError({
      error: {
        code: "RATE_LIMITED",
        message: "slow down",
        retryAfterMs: 750
      }
    });
    assert.equal(classified.type, TOOL_ERROR_TYPES.RATE_LIMITED);
    assert.equal(classified.retryable, true);
    assert.equal(classified.retryAfterMs, 750);
    assert.equal(shouldRetryToolError(classified, {
      maxAttempts: 2,
      retryOn: ["RATE_LIMITED"]
    }, 1), true);
  });

  it("never promotes permission, conflict or timeout failures into automatic retries", () => {
    for (const code of ["EACCES", "FILE_VERSION_CONFLICT", "TOOL_TIMEOUT"]) {
      const classified = classifyToolError({ code, retryable: true });
      assert.equal(shouldRetryToolError(classified, {
        maxAttempts: 3,
        retryOn: [classified.type, classified.code]
      }, 1), false);
    }
  });

  it("uses exponential Tool backoff and honors Retry-After", () => {
    assert.equal(toolRetryDelayMs({}, { backoffMs: 100 }, 1), 100);
    assert.equal(toolRetryDelayMs({}, { backoffMs: 100 }, 3), 400);
    assert.equal(toolRetryDelayMs({ retryAfterMs: 1250 }, { backoffMs: 100 }, 2), 1250);
  });
});
