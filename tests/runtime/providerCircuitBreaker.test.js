import assert from "node:assert/strict";
import test from "node:test";

import {
  CircuitBreakerRegistry,
  CircuitOpenError
} from "../../electron/runtime/CircuitBreaker.js";

test("Provider retries remain bounded by the circuit breaker", () => {
  let now = 1000;
  const breakers = new CircuitBreakerRegistry({
    scope: "provider",
    failureThreshold: 2,
    failureWindowMs: 10_000,
    cooldownMs: 5_000,
    halfOpenMaxCalls: 1,
    now: () => now
  });

  breakers.assertCanRequest("provider:model");
  breakers.recordFailure("provider:model", new Error("network"));
  breakers.assertCanRequest("provider:model");
  breakers.recordFailure("provider:model", new Error("network"));

  assert.throws(
    () => breakers.assertCanRequest("provider:model"),
    (error) => error instanceof CircuitOpenError && error.retryAfterMs === 5000
  );

  now += 5000;
  assert.equal(breakers.assertCanRequest("provider:model").state, "half_open");
  assert.throws(() => breakers.assertCanRequest("provider:model"), CircuitOpenError);
  breakers.recordSuccess("provider:model");
  assert.equal(breakers.assertCanRequest("provider:model").state, "closed");
});
