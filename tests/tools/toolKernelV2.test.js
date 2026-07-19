import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import {
  ToolExecutor
} from "../../electron/tools/core/ToolExecutor.js";
import {
  ToolEventStore
} from "../../electron/tools/core/ToolEventStore.js";
import {
  ToolPolicyEngine
} from "../../electron/tools/core/ToolPolicyEngine.js";
import {
  ToolRegistry
} from "../../electron/tools/core/ToolRegistry.js";
import {
  ToolRuntime
} from "../../electron/tools/core/ToolRuntime.js";
import {
  ToolResultStore
} from "../../electron/tools/core/ToolResultStore.js";
import {
  supportsStrictToolSchemas
} from "../../electron/tools/adapters/aiSdkToolAdapter.js";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function definition(patch = {}) {
  return {
    name: "demo",
    title: "Demo",
    inputSchema: z.object({ value: z.number().optional() }),
    sideEffect: "read",
    retryPolicy: {
      maxAttempts: 2,
      retryOn: ["TEMPORARY_FAILURE"],
      backoffMs: 0
    },
    async execute(input) {
      return { ok: true, data: input };
    },
    ...patch
  };
}

describe("Tool Runtime Kernel v2", () => {
  it("validates direct inputs before execution", async () => {
    let executions = 0;
    const executor = new ToolExecutor();
    const output = await executor.execute(
      definition({
        async execute() {
          executions += 1;
          return { ok: true };
        }
      }),
      { value: "invalid" }
    );

    assert.equal(output.ok, false);
    assert.equal(output.error.category, "invalid_input");
    assert.equal(executions, 0);
  });

  it("validates outputs and rejects non-JSON values", async () => {
    const schemaExecutor = new ToolExecutor();
    const invalidSchema = await schemaExecutor.execute(
      definition({
        outputSchema: z.object({ value: z.number() }),
        async execute() {
          return { value: "wrong" };
        }
      }),
      {}
    );
    const jsonExecutor = new ToolExecutor();
    const invalidJson = await jsonExecutor.execute(
      definition({
        async execute() {
          return { value: 1n };
        }
      }),
      {}
    );

    assert.equal(invalidSchema.error.code, "INVALID_TOOL_OUTPUT");
    assert.equal(invalidSchema.error.category, "invalid_output");
    assert.equal(invalidJson.error.code, "INVALID_TOOL_OUTPUT");
  });

  it("counts denied requests and eventually applies the request budget", async () => {
    const executor = new ToolExecutor({
      maxToolCalls: 2,
      maxIdenticalCalls: 5,
      policyEngine: new ToolPolicyEngine({
        authorize: () => ({
          decision: "deny",
          code: "TEST_POLICY_DENIED",
          message: "denied"
        })
      })
    });

    const first = await executor.execute(definition(), { value: 1 });
    const second = await executor.execute(definition(), { value: 2 });
    const third = await executor.execute(definition(), { value: 3 });

    assert.equal(first.error.category, "policy_denied");
    assert.equal(second.error.category, "policy_denied");
    assert.equal(third.error.code, "TOOL_CALL_LIMIT");
    const budget = executor.getBudget();
    assert.equal(budget.requestCount, 3);
    assert.equal(budget.executionCount, 0);
    assert.equal(budget.retryCount, 0);
    assert.equal(budget.deniedCount, 3);
    assert.equal(budget.bytesIn > 0, true);
    assert.equal(budget.bytesOut > 0, true);
  });

  it("does not spend the ordinary quota on explicitly unmetered reads", async () => {
    const executor = new ToolExecutor({
      maxToolCalls: 1,
      maxTotalToolCalls: 10,
      maxIdenticalCalls: 1
    });
    const read = definition({ countsTowardLimit: false });
    const write = definition({
      name: "write_demo",
      sideEffect: "write",
      countsTowardLimit: true
    });

    assert.equal((await executor.execute(read, { value: 1 })).ok, true);
    assert.equal((await executor.execute(read, { value: 2 })).ok, true);
    assert.equal((await executor.execute(write, { value: 3 })).ok, true);

    const limited = await executor.execute(write, { value: 4 });
    const repeated = await executor.execute(read, { value: 1 });
    const budget = executor.getBudget();

    assert.equal(limited.error.code, "TOOL_CALL_LIMIT");
    assert.equal(repeated.ok, true);
    assert.equal(budget.requestCount, 2);
    assert.equal(budget.unmeteredRequestCount, 3);
    assert.equal(budget.totalRequestCount, 5);
  });


  it("keeps an emergency fuse for otherwise unmetered tools", async () => {
    const executor = new ToolExecutor({
      maxToolCalls: 1,
      maxTotalToolCalls: 2,
      maxIdenticalCalls: 1
    });
    const read = definition({
      countsTowardLimit: false,
      countsTowardRepeatLimit: false
    });

    assert.equal((await executor.execute(read, { value: 1 })).ok, true);
    assert.equal((await executor.execute(read, { value: 1 })).ok, true);

    const fused = await executor.execute(read, { value: 1 });

    assert.equal(fused.error.code, "TOOL_EMERGENCY_LIMIT");
    assert.equal(
      executor.getRecords().at(-1).activityVisibility,
      "developer"
    );
  });

  it("uses canonical signatures for semantically identical objects", async () => {
    const executor = new ToolExecutor({ maxIdenticalCalls: 1 });
    const flexible = definition({
      inputSchema: z.object({ a: z.number(), b: z.number() })
    });

    await executor.execute(flexible, { a: 1, b: 2 });
    const repeated = await executor.execute(flexible, { b: 2, a: 1 });

    assert.equal(repeated.error.code, "REPEATED_TOOL_CALL");
  });

  it("never retries writes without an idempotency guarantee", async () => {
    let attempts = 0;
    const executor = new ToolExecutor({ maxRetries: 2 });
    const output = await executor.execute(
      definition({
        sideEffect: "write",
        idempotency: "none",
        retryPolicy: {
          maxAttempts: 3,
          retryOn: ["TEMPORARY_FAILURE"],
          backoffMs: 0
        },
        async execute() {
          attempts += 1;
          return {
            ok: false,
            error: { code: "EAGAIN", message: "temporary" }
          };
        }
      }),
      {}
    );

    assert.equal(output.ok, false);
    assert.equal(attempts, 1);
  });

  it("allows bounded write retries only with a required idempotency key", async () => {
    let attempts = 0;
    const executor = new ToolExecutor({ maxRetries: 1 });
    const output = await executor.execute(
      definition({
        sideEffect: "write",
        idempotency: "required",
        async execute() {
          attempts += 1;
          return attempts === 1
            ? {
                ok: false,
                error: { code: "EAGAIN", message: "temporary" }
              }
            : { ok: true, data: { written: true } };
        }
      }),
      {},
      { idempotencyKey: "write-once" }
    );

    assert.equal(output.ok, true);
    assert.equal(attempts, 2);
  });

  it("supports approval decisions without executing the tool", async () => {
    let executions = 0;
    const executor = new ToolExecutor({
      policyEngine: new ToolPolicyEngine({
        authorize: () => ({
          decision: "require_approval",
          request: { reason: "external write" }
        })
      })
    });
    const output = await executor.execute(
      definition({
        async execute() {
          executions += 1;
        }
      }),
      {}
    );

    assert.equal(output.error.code, "APPROVAL_REQUIRED");
    assert.equal(output.error.category, "approval_required");
    assert.equal(executions, 0);
  });

  it("serializes calls sharing an exclusive concurrency key", async () => {
    let active = 0;
    let peak = 0;
    const executor = new ToolExecutor({ maxConcurrent: 4 });
    const exclusive = definition({
      concurrencyKey: "workspace-index",
      async execute() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { ok: true };
      }
    });

    await Promise.all([
      executor.execute(exclusive, { value: 1 }),
      executor.execute(exclusive, { value: 2 })
    ]);

    assert.equal(peak, 1);
  });

  it("propagates deadline cancellation to cooperative tool implementations", async () => {
    let observedAbort = false;
    const executor = new ToolExecutor({
      runTimeoutMs: 20,
      defaultTimeoutMs: 1000
    });
    const output = await executor.execute(
      definition({
        async execute(_input, context) {
          return new Promise((resolve) => {
            context.abortSignal.addEventListener(
              "abort",
              () => {
                observedAbort = true;
                resolve({ ok: false });
              },
              { once: true }
            );
          });
        }
      }),
      {}
    );

    assert.equal(output.error.category, "timeout");
    assert.equal(observedAbort, true);
  });

  it("records an append-only lifecycle event stream", async () => {
    const executor = new ToolExecutor();
    await executor.execute(definition(), { value: 1 }, { toolCallId: "event-1" });

    const events = executor.getEvents();
    assert.deepEqual(events.map((event) => event.status), [
      "queued",
      "running",
      "completed"
    ]);
    assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
    assert.equal(events.every((event) => event.callId === "event-1"), true);
  });

  it("reopens persisted append-only events after restart", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tool-event-store-")
    );
    temporaryDirectories.push(directory);
    const storageFile = path.join(directory, "events.jsonl");
    const first = new ToolEventStore({ storageFile });
    first.append({ type: "tool_lifecycle", status: "queued" });
    first.append({ type: "tool_lifecycle", status: "completed" });
    await first.close();
    const reopened = new ToolEventStore({ storageFile });

    assert.deepEqual(
      reopened.list().map((event) => event.status),
      ["queued", "completed"]
    );
    assert.equal(reopened.list()[1].sequence, 2);
    assert.deepEqual(
      reopened.projectRecords(),
      []
    );
  });

  it("redacts audit event secrets before projection", () => {
    const events = new ToolEventStore();
    events.append({
      type: "tool_lifecycle",
      callId: "secret-call",
      record: {
        id: "secret-call",
        status: "completed",
        input: { token: "secret" }
      }
    });

    assert.equal(
      events.projectRecords()[0].input.token,
      "[REDACTED]"
    );
  });

  it("binds persisted result references to their task owner", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tool-result-owner-")
    );
    temporaryDirectories.push(directory);
    const first = new ToolResultStore({
      storageDirectory: directory,
      taskId: "task-a",
      maxInlineBytes: 2000
    });
    const captured = first.capture({
      ok: true,
      data: { text: "x".repeat(4000) }
    });
    const second = new ToolResultStore({
      storageDirectory: directory,
      taskId: "task-b",
      maxInlineBytes: 2000
    });

    assert.equal(
      second.read(captured.result.reference.resultId).error.code,
      "TOOL_RESULT_NOT_FOUND"
    );
  });

  it("redacts common secret fields before results are exposed or stored", () => {
    const store = new ToolResultStore();
    const captured = store.capture({
      ok: true,
      data: {
        token: "secret-token",
        nested: { password: "secret-password", value: 42 }
      }
    });

    assert.equal(captured.value.data.token, "[REDACTED]");
    assert.equal(captured.value.data.nested.password, "[REDACTED]");
    assert.equal(captured.value.data.nested.value, 42);
  });

  it("publishes versioned IDs, capabilities and idempotency in the manifest", () => {
    const registry = new ToolRegistry();
    registry.register(definition(), {
      source: "custom.test",
      toolset: "custom.read"
    });
    const [manifest] = registry.manifest();

    assert.equal(manifest.id, "custom.test.demo@1");
    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.toolsets, ["custom.read"]);
    assert.equal(manifest.idempotency, "natural");
    const writeRegistry = new ToolRegistry();
    writeRegistry.register(definition({
      name: "write_demo",
      sideEffect: "write"
    }));
    const [writeManifest] = writeRegistry.manifest();

    assert.equal(manifest.countsTowardLimit, false);
    assert.equal(writeManifest.countsTowardLimit, true);
  });

  it("runs a frozen custom Tool snapshot without AgentRuntime", async () => {
    const registry = new ToolRegistry();
    registry.register(
      definition({ name: "custom_read" }),
      {
        source: "custom.local",
        toolset: "custom.read"
      }
    );
    const snapshot = registry.freeze();
    const runtime = new ToolRuntime({ registry: snapshot });
    const output = await runtime.invoke(
      "custom_read",
      { value: 42 },
      { toolCallId: "custom-call" }
    );

    assert.equal(output.ok, true);
    assert.equal(output.data.value, 42);
    assert.equal(runtime.getRecords()[0].id, "custom-call");
    assert.equal(runtime.getEvents().length, 3);
    assert.throws(
      () => registry.register(definition({ name: "late_tool" })),
      /registry is frozen/u
    );
  });

  it("returns a canonical error for an unregistered Tool", async () => {
    const runtime = new ToolRuntime();
    const output = await runtime.invoke("missing_tool", {});

    assert.equal(output.error.code, "TOOL_NOT_FOUND");
    assert.equal(output.error.category, "not_found");
    assert.equal(runtime.getEvents().length, 0);
  });

  it("enables strict provider schemas only for declared capabilities", () => {
    assert.equal(supportsStrictToolSchemas({ provider: "openai" }), true);
    assert.equal(supportsStrictToolSchemas({ provider: "anthropic" }), false);
    assert.equal(
      supportsStrictToolSchemas({
        provider: "openai-compatible",
        supportsStrictToolSchemas: true
      }),
      true
    );
  });
});
