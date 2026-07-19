import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  ToolRegistry
} from "../../electron/tools/core/ToolRegistry.js";

function definition(name, patch = {}) {
  return {
    name,
    title: name,
    description: `${name} description`,
    inputSchema: z.object({}),
    async execute() {
      return { ok: true };
    },
    ...patch
  };
}

describe("ToolRegistry foundation", () => {
  it("normalizes safe read tools with bounded retry metadata", () => {
    const registry = new ToolRegistry();
    const registered = registry.register(
      definition("read_demo"),
      {
        source: "builtin.test",
        sideEffect: "read",
        riskLevel: "low"
      }
    );

    assert.equal(registered.source, "builtin.test");
    assert.equal(registered.sideEffect, "read");
    assert.equal(registered.riskLevel, "low");
    assert.equal(registered.countsTowardLimit, false);
    assert.equal(registered.countsTowardRepeatLimit, false);
    assert.equal(registered.activityVisibility, "normal");
    assert.equal(registered.retryPolicy.maxAttempts, 2);
    assert.deepEqual(
      registered.retryPolicy.retryOn,
      ["TEMPORARY_FAILURE"]
    );
  });


  it("hides simple no-side-effect tools from normal activity by default", () => {
    const registry = new ToolRegistry();
    const registered = registry.register(
      definition("calculator", {
        sideEffect: "none",
        riskLevel: "none"
      })
    );

    assert.equal(registered.countsTowardLimit, false);
    assert.equal(registered.countsTowardRepeatLimit, false);
    assert.equal(registered.activityVisibility, "developer");

    const manifest = registry.manifest()[0];
    assert.equal(manifest.activityVisibility, "developer");
    assert.equal(manifest.countsTowardRepeatLimit, false);
  });

  it("does not make write tools retryable by default", () => {
    const registry = new ToolRegistry();
    const registered = registry.register(
      definition("write_demo", {
        sideEffect: "write",
        riskLevel: "medium"
      })
    );

    assert.equal(registered.retryPolicy.maxAttempts, 1);
    assert.deepEqual(registered.retryPolicy.retryOn, []);
  });

  it("rejects duplicate names and exposes a stable manifest", () => {
    const registry = new ToolRegistry();
    registry.register(definition("demo"));

    assert.throws(
      () => registry.register(definition("demo")),
      /already registered/
    );
    assert.deepEqual(
      registry.manifest().map((item) => item.name),
      ["demo"]
    );
  });
});
