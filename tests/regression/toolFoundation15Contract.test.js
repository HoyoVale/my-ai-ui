import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime = fs.readFileSync(
  new URL("../../electron/agent/AgentRuntime.js", import.meta.url),
  "utf8"
);
const main = fs.readFileSync(
  new URL("../../electron/main.js", import.meta.url),
  "utf8"
);
const messages = fs.readFileSync(
  new URL("../../src/Conversation/components/MessageList.jsx", import.meta.url),
  "utf8"
);

describe("Tool Foundation 1.5 contract", () => {
  it("persists one assistant run placeholder and compact checkpoints", () => {
    assert.match(runtime, /ensureActiveAssistantMessage/);
    assert.match(runtime, /createRunCheckpoint/);
    assert.match(runtime, /persistActiveRunCheckpoint/);
  });

  it("cancels the model and Tool stream while preserving a cancelled activity record", () => {
    assert.match(runtime, /finishCancelledRun/);
    assert.match(runtime, /abortController[\s\S]*\.abort/);
    assert.match(runtime, /state:\s*"cancelling"/);
  });

  it("recovers unfinished persisted runs when Electron starts", () => {
    assert.match(main, /recoverInterruptedRuns/);
  });

  it("provides a fixed other answer and a return-to-current activity control", () => {
    assert.match(messages, /OTHER_OPTION_ID = "__other__"/);
    assert.match(messages, /其它回答/);
    assert.match(messages, /conversation-return-to-current/);
  });
});
