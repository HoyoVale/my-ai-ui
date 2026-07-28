import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    "utf8"
  );
}

const runtime = read("electron/agent/AgentRuntime.js");
const execution = read("electron/agent/execution/AgentRunExecution.js");
const loop = read("electron/agent/execution/CoreLiteRunLoop.js");
const finalization = read("electron/agent/finalization/AgentRunFinalization.js");
const compatibility = read("electron/conversation/legacyConversationCompatibility.js");

describe("Core Lite 4.2 cancellation consistency contract", () => {
  it("makes repeated stop requests idempotent", () => {
    assert.match(runtime, /requestCancellation\("user-stop"\)/u);
    assert.match(runtime, /already-cancelling/u);
    assert.match(runtime, /alreadyStopping:\s*true/u);
    assert.match(runtime, /signal\.aborted/u);
  });

  it("uses the run signal rather than any AbortError as cancellation authority", () => {
    assert.match(execution, /isCancellationRequested/u);
    assert.doesNotMatch(execution, /isAbortError/u);
    assert.match(execution, /throwIfAborted\(abortController\.signal\)/u);
    assert.match(loop, /finalizationResult\?\.aborted/u);
  });

  it("settles cancellation once and keeps persistence failures from blocking terminal cleanup", () => {
    assert.match(finalization, /cancellationCompletion/u);
    assert.match(finalization, /Promise\.allSettled/u);
    assert.match(finalization, /CANCELLATION_PERSISTENCE_TIMEOUT/u);
    assert.match(finalization, /RUN_CANCELLED/u);
    assert.match(finalization, /RUN_INTERRUPTED/u);
  });

  it("synchronizes the Response window with the final persisted cancellation text", () => {
    assert.match(finalization, /replaceResponseText\(run\.finalText\)/u);
    assert.match(finalization, /saveAbortedReplies/u);
    assert.match(finalization, /resolveRunTerminalPresentation/u);
    assert.match(finalization, /terminal\.message/u);
    assert.match(finalization, /markCancellationSettled/u);
  });

  it("removes the unused legacy compatibility clone helper", () => {
    assert.doesNotMatch(compatibility, /function clone\(/u);
  });
});
