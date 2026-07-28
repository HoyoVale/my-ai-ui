import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyProviderError,
  providerErrorMessage
} from "../../electron/agent/ProviderErrorClassifier.js";

import {
  providerRetryDelayMs,
  resolveProviderRetry,
  waitForProviderRetry
} from "../../electron/agent/ProviderRetryPolicy.js";

describe("Provider retry policy", () => {
  it("retries transient failures but never authentication or quota failures", () => {
    const rateLimited = classifyProviderError({
      status: 429,
      message: "rate limit",
      headers: { "retry-after": "2" }
    });
    assert.equal(rateLimited.category, "rate_limited");
    assert.equal(rateLimited.retryable, true);
    assert.equal(rateLimited.retryAfterMs, 2000);

    const auth = classifyProviderError({ status: 401, message: "bad key", retryable: true });
    assert.equal(auth.category, "authentication");
    assert.equal(auth.retryable, false);
    assert.match(providerErrorMessage(auth), /API Key/u);

    const quota = classifyProviderError({ status: 402, message: "quota exceeded" });
    assert.equal(quota.category, "quota");
    assert.equal(quota.retryable, false);
  });

  it("does not mistake an unrelated AbortError for user cancellation", () => {
    const error = new Error("provider stream timed out");
    error.name = "AbortError";
    const classified = classifyProviderError(error, {
      cancellationRequested: false
    });
    assert.equal(classified.category, "timeout");
    assert.equal(classified.retryable, true);

    const cancelled = classifyProviderError(error, {
      cancellationRequested: true
    });
    assert.equal(cancelled.category, "cancelled");
    assert.equal(cancelled.retryable, false);
  });

  it("retries only before public output or Tool activity", () => {
    const error = Object.assign(new Error("network unavailable"), {
      code: "ECONNRESET"
    });
    const safe = resolveProviderRetry({
      error,
      attempt: 1,
      maxRetries: 2,
      remainingMs: 10_000,
      random: () => 0.5
    });
    assert.equal(safe.retry, true);
    assert.equal(safe.nextAttempt, 2);
    assert.equal(safe.maxAttempts, 3);

    assert.equal(resolveProviderRetry({
      error,
      attempt: 1,
      maxRetries: 2,
      publicOutputStarted: true,
      remainingMs: 10_000
    }).reason, "public-output-started");

    assert.equal(resolveProviderRetry({
      error,
      attempt: 1,
      maxRetries: 2,
      toolActivityStarted: true,
      remainingMs: 10_000
    }).reason, "tool-activity-started");
  });

  it("honors attempt, circuit and deadline boundaries", () => {
    const network = Object.assign(new Error("network"), { code: "ECONNRESET" });
    assert.equal(resolveProviderRetry({
      error: network,
      attempt: 2,
      maxRetries: 1,
      remainingMs: 10_000
    }).reason, "attempt-limit");

    const circuit = Object.assign(new Error("open"), {
      code: "CIRCUIT_OPEN",
      retryable: true,
      retryAfterMs: 45_000
    });
    assert.equal(resolveProviderRetry({
      error: circuit,
      attempt: 1,
      maxRetries: 2,
      remainingMs: 60_000
    }).reason, "manual-retry-only");

    assert.equal(resolveProviderRetry({
      error: network,
      attempt: 1,
      maxRetries: 2,
      remainingMs: 100,
      random: () => 0.5
    }).reason, "deadline");
  });

  it("uses bounded exponential delay and supports cancellation while waiting", async () => {
    assert.equal(providerRetryDelayMs({
      attempt: 1,
      random: () => 0.5
    }), 400);
    assert.equal(providerRetryDelayMs({
      attempt: 2,
      retryAfterMs: 1500,
      random: () => 0.5
    }), 1500);

    const controller = new AbortController();
    const pending = waitForProviderRetry(1000, controller.signal);
    controller.abort("user-stop");
    await assert.rejects(pending, (error) => error.name === "AbortError");
  });
});
