import assert from "node:assert/strict";
import test from "node:test";

import {
  CircuitBreakerRegistry,
  CircuitOpenError
} from "../../electron/runtime/CircuitBreaker.js";

import {
  ToolExecutor
} from "../../electron/tools/core/ToolExecutor.js";
import {
  ToolRegistry
} from "../../electron/tools/core/ToolRegistry.js";

import { z } from "zod";

test("circuit breaker opens, rejects requests, and permits one half-open probe", () => {
  let now = 1_000;
  const breakers = new CircuitBreakerRegistry({
    scope: "provider",
    failureThreshold: 2,
    failureWindowMs: 10_000,
    cooldownMs: 5_000,
    now: () => now
  });

  assert.equal(breakers.beforeRequest("provider:model").ok, true);
  breakers.recordFailure("provider:model", new Error("network"));
  breakers.recordFailure("provider:model", new Error("network"));

  assert.throws(
    () => breakers.assertCanRequest("provider:model"),
    (error) => error instanceof CircuitOpenError && error.retryAfterMs === 5_000
  );

  now += 5_001;
  assert.equal(breakers.beforeRequest("provider:model").state, "half_open");
  assert.equal(breakers.beforeRequest("provider:model").ok, false);

  breakers.recordSuccess("provider:model");
  assert.equal(breakers.snapshot().entries[0].state, "closed");
});

test("ToolExecutor stops dispatching a repeatedly unavailable tool while the circuit is open", async () => {
  const breakers = new CircuitBreakerRegistry({
    scope: "tool",
    failureThreshold: 2,
    cooldownMs: 60_000
  });
  let executions = 0;
  const registry = new ToolRegistry();
  registry.register({
    name: "unstable_tool",
    title: "Unstable tool",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    sideEffect: "read",
    execute: async () => {
      executions += 1;
      const error = new Error("temporary network failure");
      error.code = "ETIMEDOUT";
      throw error;
    }
  });

  const executor = new ToolExecutor({
    circuitBreakers: breakers,
    maxRetries: 0
  });
  const tool = registry.get("unstable_tool");

  await executor.execute(tool, {}, { toolCallId: "call-1" });
  await executor.execute(tool, {}, { toolCallId: "call-2" });
  const blocked = await executor.execute(tool, {}, { toolCallId: "call-3" });

  assert.equal(executions, 2);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "TOOL_CIRCUIT_OPEN");
  assert.equal(breakers.publicSnapshot().openCount, 1);
});

test("runtime circuit breaker configuration and manual reset are observable", async () => {
  const {
    configureRuntimeCircuitBreakers,
    getRuntimeCircuitBreakerSnapshot,
    providerCircuitBreakers,
    resetRuntimeCircuitBreaker,
    toolCircuitBreakers
  } = await import("../../electron/runtime/runtimeCircuitBreakers.js");

  resetRuntimeCircuitBreaker({ scope: "all" });
  configureRuntimeCircuitBreakers({
    tools: {
      runtime: {
        circuitBreakers: {
          provider: {
            failureThreshold: 5,
            failureWindowMs: 20_000,
            cooldownMs: 7_000,
            halfOpenMaxCalls: 2
          },
          tool: {
            failureThreshold: 4,
            failureWindowMs: 15_000,
            cooldownMs: 6_000,
            halfOpenMaxCalls: 3
          }
        }
      }
    }
  });

  providerCircuitBreakers.recordFailure("provider:model", new Error("temporary"));
  toolCircuitBreakers.recordFailure("tool:name", new Error("temporary"));

  const configured = getRuntimeCircuitBreakerSnapshot();
  assert.equal(configured.provider.failureThreshold, 5);
  assert.equal(configured.provider.halfOpenMaxCalls, 2);
  assert.equal(configured.tool.failureThreshold, 4);
  assert.equal(configured.tool.halfOpenMaxCalls, 3);
  assert.equal(configured.provider.entries.length, 1);
  assert.equal(configured.tool.entries.length, 1);

  const resetProvider = resetRuntimeCircuitBreaker({
    scope: "provider",
    key: "provider:model"
  });
  assert.equal(resetProvider.ok, true);
  assert.equal(resetProvider.snapshot.provider.entries.length, 0);
  assert.equal(resetProvider.snapshot.tool.entries.length, 1);

  resetRuntimeCircuitBreaker({ scope: "all" });
});
