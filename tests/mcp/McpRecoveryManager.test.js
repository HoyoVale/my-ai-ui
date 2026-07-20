import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  McpRecoveryManager
} from "../../electron/mcp/McpRecoveryManager.js";

const managers = new Set();

afterEach(() => {
  for (const manager of managers) manager.close();
  managers.clear();
});

describe("MCP recovery manager", () => {
  it("uses bounded exponential backoff and resets after recovery", async () => {
    const scheduled = [];
    let connects = 0;
    const fakeManager = {
      settings: {
        recovery: {
          enabled: true,
          maxAttempts: 3,
          baseDelayMs: 10,
          maxDelayMs: 20
        }
      },
      getServerConfig() {
        return {
          id: "fixture",
          enabled: true,
          autoConnect: true,
          recovery: { enabled: true, maxAttempts: 3 }
        };
      },
      markRecoveryScheduled(_id, attempt, delayMs) {
        scheduled.push({ attempt, delayMs });
      },
      markRecoveryExhausted() {
        throw new Error("should not exhaust");
      },
      async connectServer() {
        connects += 1;
        if (connects === 1) throw new Error("temporary");
      }
    };
    const recovery = new McpRecoveryManager({ manager: fakeManager });
    managers.add(recovery);

    recovery.schedule("fixture", "test");
    await new Promise((resolve) => setTimeout(resolve, 900));

    assert.equal(connects, 2);
    assert.deepEqual(scheduled, [
      { attempt: 1, delayMs: 250 },
      { attempt: 2, delayMs: 500 }
    ]);
  });

  it("does not schedule disabled connections", () => {
    const fakeManager = {
      settings: { recovery: { enabled: true } },
      getServerConfig() {
        return { id: "fixture", enabled: false, autoConnect: false };
      }
    };
    const recovery = new McpRecoveryManager({ manager: fakeManager });
    managers.add(recovery);

    assert.equal(recovery.schedule("fixture"), false);
  });
});
