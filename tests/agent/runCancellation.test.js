import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  AgentRunSession
} from "../../electron/agent/AgentRunSession.js";

import {
  createAbortError,
  isCancellationRequested,
  throwIfAborted
} from "../../electron/agent/agentErrors.js";

function createSession() {
  return new AgentRunSession({
    runId: "run-1",
    taskId: "task-1",
    conversationId: "conversation-1",
    abortController: new AbortController()
  });
}

describe("Core Lite run cancellation", () => {
  it("records one idempotent cancellation request on the run session", () => {
    const session = createSession();

    assert.equal(session.requestCancellation("user-stop", 100), true);
    assert.equal(session.requestCancellation("user-stop", 200), false);

    const snapshot = session.snapshot();
    assert.deepEqual(snapshot.cancellation, {
      requested: true,
      requestedAt: 100,
      reason: "user-stop",
      settledAt: null
    });

    session.markCancellationSettled(300);
    assert.equal(session.snapshot().cancellation.settledAt, 300);
  });

  it("distinguishes user cancellation from unrelated AbortError values", () => {
    const session = createSession();
    const timeoutError = new Error("provider timeout");
    timeoutError.name = "AbortError";

    assert.equal(
      isCancellationRequested(session, session.abortController.signal),
      false
    );
    assert.equal(timeoutError.name, "AbortError");

    session.requestCancellation();
    assert.equal(
      isCancellationRequested(session, session.abortController.signal),
      true
    );
  });

  it("throws one canonical AbortError from an aborted run signal", () => {
    const controller = new AbortController();
    controller.abort("user-stop");

    assert.throws(
      () => throwIfAborted(controller.signal),
      (error) => {
        assert.equal(error.name, "AbortError");
        assert.equal(error.code, "ABORT_ERR");
        assert.equal(error.message, "user-stop");
        return true;
      }
    );

    const error = createAbortError(controller.signal);
    assert.equal(error.name, "AbortError");
  });
});
