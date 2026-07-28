import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";

import {
  buildE2EResponse,
  streamE2EResponse
} from "../../electron/agent/e2eAgentDriver.js";

function messages(content) {
  return [{ role: "user", content }];
}

test("E2E long stream has deterministic begin/end markers", () => {
  const text = buildE2EResponse(
    messages("e2e-long-stream-complete")
  );

  assert.match(
    text,
    /^E2E_LONG_STREAM_BEGIN:e2e-long-stream-complete/u
  );
  assert.match(
    text,
    /E2E_LONG_STREAM_LINE_180:/u
  );
  assert.match(
    text,
    /E2E_LONG_STREAM_END:e2e-long-stream-complete$/u
  );
});

test("E2E long stream removes every abort listener after completion", async () => {
  const previousChunks = process.env.XIXI_E2E_LONG_STREAM_CHUNKS;
  const previousDelay = process.env.XIXI_E2E_LONG_STREAM_DELAY_MS;
  process.env.XIXI_E2E_LONG_STREAM_CHUNKS = "60";
  process.env.XIXI_E2E_LONG_STREAM_DELAY_MS = "1";

  const controller = new AbortController();
  const chunks = [];

  try {
    const text = await streamE2EResponse({
      messages: messages("e2e-long-stream-listener-cleanup"),
      signal: controller.signal,
      onChunk: (chunk) => chunks.push(chunk)
    });

    assert.equal(chunks.join(""), text);
    assert.equal(chunks.length >= 24, true);
    assert.equal(
      getEventListeners(controller.signal, "abort").length,
      0
    );
  } finally {
    if (previousChunks === undefined) {
      delete process.env.XIXI_E2E_LONG_STREAM_CHUNKS;
    } else {
      process.env.XIXI_E2E_LONG_STREAM_CHUNKS = previousChunks;
    }
    if (previousDelay === undefined) {
      delete process.env.XIXI_E2E_LONG_STREAM_DELAY_MS;
    } else {
      process.env.XIXI_E2E_LONG_STREAM_DELAY_MS = previousDelay;
    }
  }
});

test("E2E long stream aborts promptly and releases its listener", async () => {
  const previousDelay = process.env.XIXI_E2E_LONG_STREAM_DELAY_MS;
  process.env.XIXI_E2E_LONG_STREAM_DELAY_MS = "25";
  const controller = new AbortController();
  let chunks = 0;

  try {
    const execution = streamE2EResponse({
      messages: messages("e2e-long-stream-cancel"),
      signal: controller.signal,
      onChunk: () => {
        chunks += 1;
        if (chunks === 2) {
          controller.abort("test-cancel");
        }
      }
    });

    await assert.rejects(execution, (error) => {
      assert.equal(error?.name, "AbortError");
      return true;
    });
    assert.equal(
      getEventListeners(controller.signal, "abort").length,
      0
    );
  } finally {
    if (previousDelay === undefined) {
      delete process.env.XIXI_E2E_LONG_STREAM_DELAY_MS;
    } else {
      process.env.XIXI_E2E_LONG_STREAM_DELAY_MS = previousDelay;
    }
  }
});
