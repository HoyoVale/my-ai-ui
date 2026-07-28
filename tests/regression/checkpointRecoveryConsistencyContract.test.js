import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Core Lite 4.4 checkpoint recovery contract", () => {
  it("validates checkpoint bindings before appending the continuation message", () => {
    const preparation = read(
      "../../electron/agent/preparation/AgentRunPreparation.js"
    );
    const inspectIndex = preparation.indexOf(
      "inspectCoreLiteCheckpointRecovery"
    );
    const appendIndex = preparation.indexOf(
      "conversationManager.appendMessage"
    );

    assert.ok(inspectIndex >= 0);
    assert.ok(appendIndex > inspectIndex);
    assert.match(preparation, /preparedExecution\.settings\.model/u);
  });

  it("reconciles Tool receipts before starting or resuming the model loop", () => {
    const execution = read(
      "../../electron/agent/execution/AgentRunExecution.js"
    );
    const reconcileIndex = execution.indexOf(
      "toolSession.reconcileRuntime"
    );
    const startedIndex = execution.indexOf(
      '"RUN_STARTED"'
    );

    assert.ok(reconcileIndex >= 0);
    assert.ok(startedIndex > reconcileIndex);
    assert.match(execution, /RUN_RESUME_BLOCKED/u);
    assert.match(execution, /RUN_RESUMED/u);
    assert.match(execution, /reportedReceiptIds/u);
  });

  it("persists bounded partial output and restores it after interruption", () => {
    const checkpoint = read(
      "../../electron/agent/CoreLiteCheckpoint.js"
    );
    const persistence = read(
      "../../electron/agent/persistence/AgentRunPersistence.js"
    );
    const recovery = read(
      "../../electron/conversation/services/ConversationMessageService.js"
    );

    assert.match(checkpoint, /partialResponse/u);
    assert.match(checkpoint, /CORE_LITE_RUN_CHECKPOINT_VERSION = 6/u);
    assert.match(persistence, /saveAbortedReplies/u);
    assert.match(recovery, /savedPartialResponse/u);
  });
});
