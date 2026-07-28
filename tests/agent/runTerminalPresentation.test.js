import {
  describe,
  it
} from "node:test";

import assert from "node:assert/strict";

import {
  composeTerminalResponse,
  resolveRunTerminalPresentation,
  RUN_TERMINAL_CODES,
  sanitizeRunTerminalPresentation
} from "../../electron/agent/RunTerminalPresentation.js";

import {
  PROVIDER_ERROR_CATEGORIES
} from "../../electron/agent/ProviderErrorClassifier.js";

import {
  RUN_STOP_REASONS
} from "../../electron/agent/runStopReasons.js";

describe("Run terminal presentation", () => {
  it("maps provider failures to one stable public contract", () => {
    const terminal = resolveRunTerminalPresentation({
      outcome: "failed",
      stopReason: RUN_STOP_REASONS.MODEL_ERROR,
      providerClassification: {
        category: PROVIDER_ERROR_CATEGORIES.AUTHENTICATION
      }
    });

    assert.equal(terminal.code, RUN_TERMINAL_CODES.PROVIDER_AUTHENTICATION);
    assert.equal(terminal.kind, "failure");
    assert.equal(terminal.action, "open_model_settings");
    assert.match(terminal.message, /API Key/u);
    assert.equal("stack" in terminal, false);
  });

  it("prioritizes uncertain Tool recovery over an ordinary model failure", () => {
    const terminal = resolveRunTerminalPresentation({
      outcome: "failed",
      stopReason: RUN_STOP_REASONS.MODEL_ERROR,
      runtimeRecovery: {
        unresolvedCount: 1,
        needsReconciliation: 1
      },
      providerClassification: {
        category: PROVIDER_ERROR_CATEGORIES.NETWORK
      }
    });

    assert.equal(terminal.code, RUN_TERMINAL_CODES.TOOL_RECONCILIATION_REQUIRED);
    assert.equal(terminal.kind, "attention");
    assert.equal(terminal.resumable, true);
    assert.equal(terminal.action, "review_recovery");
  });

  it("presents graceful runtime boundaries as resumable checkpoints", () => {
    const terminal = resolveRunTerminalPresentation({
      outcome: "continuable",
      stopReason: RUN_STOP_REASONS.AGENT_RUN_TIMEOUT,
      resumable: true
    });

    assert.equal(terminal.code, RUN_TERMINAL_CODES.RUN_TIMEOUT);
    assert.equal(terminal.kind, "continuable");
    assert.equal(terminal.action, "continue");
    assert.equal(terminal.resumable, true);
  });

  it("maps Tool permission failures without exposing raw Tool details", () => {
    const terminal = resolveRunTerminalPresentation({
      outcome: "failed",
      stopReason: RUN_STOP_REASONS.PERMISSION_DENIED,
      records: [{
        id: "tool-1",
        name: "write_text_file",
        status: "failed",
        result: {
          error: {
            code: "PERMISSION_DENIED",
            message: "C:/secret/path",
            retryable: false
          }
        }
      }]
    });

    assert.equal(terminal.code, RUN_TERMINAL_CODES.TOOL_PERMISSION);
    assert.equal(terminal.action, "review_permissions");
    assert.doesNotMatch(terminal.message, /secret/u);
  });

  it("marks a successful local finalization fallback without turning the Run into a failure", () => {
    const terminal = resolveRunTerminalPresentation({
      outcome: "completed",
      stopReason: RUN_STOP_REASONS.COMPLETED,
      finalizationFailure: {
        code: "PROVIDER_NETWORK"
      }
    });

    assert.equal(terminal.code, RUN_TERMINAL_CODES.COMPLETED_WITH_FALLBACK);
    assert.equal(terminal.kind, "completed");
    assert.equal(terminal.outcome, "completed");
  });

  it("replaces raw warning text with the stable terminal message", () => {
    const terminal = resolveRunTerminalPresentation({
      outcome: "failed",
      stopReason: RUN_STOP_REASONS.MODEL_ERROR,
      providerClassification: {
        category: PROVIDER_ERROR_CATEGORIES.NETWORK
      }
    });

    assert.equal(
      composeTerminalResponse("⚠ fetch failed at internal.host", terminal),
      terminal.message
    );
    assert.equal(
      composeTerminalResponse("已完成部分检查。", terminal),
      `已完成部分检查。\n\n${terminal.message}`
    );
  });

  it("sanitizes persisted terminal snapshots", () => {
    const terminal = sanitizeRunTerminalPresentation({
      version: 99,
      code: "provider_network",
      kind: "failure",
      title: "网络错误",
      message: "x".repeat(1000),
      action: "retry",
      outcome: "failed",
      stopReason: "model_error",
      resumable: false,
      stack: "private"
    });

    assert.equal(terminal.version, 1);
    assert.equal(terminal.message.length <= 500, true);
    assert.equal("stack" in terminal, false);
  });
});
