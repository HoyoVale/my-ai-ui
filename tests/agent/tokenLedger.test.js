import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TokenLedger,
  aggregateTokenLedgers,
  sanitizeTokenLedgerSnapshot
} from "../../electron/agent/TokenLedger.js";

import {
  recordGoalTokenUsage,
  upsertGoal
} from "../../electron/goal/GoalRuntime.js";

import {
  sanitizeMessage
} from "../../electron/conversation/conversationSchema.js";

describe("Token Ledger", () => {
  it("persists provider usage and estimates schemas, arguments and results", () => {
    let now = 100;
    const ledger = new TokenLedger({
      runId: "run-1",
      goalId: "goal-1",
      taskId: "task-1",
      context: {
        budget: {
          inputTokens: 120,
          outputReserve: 50,
          contextTokenBudget: 1000,
          sections: [{ id: "messages", label: "最近对话", tokens: 120 }]
        }
      },
      now: () => now++
    });

    ledger.setToolDefinitions([{
      name: "read_text_file",
      description: "Read one file",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } }
      }
    }]);
    ledger.recordTool({
      id: "call-1",
      name: "read_text_file",
      status: "completed",
      input: { path: "src/main.js" },
      output: { content: "export const value = 1;", cacheReused: true }
    });
    ledger.recordProviderUsage({
      inputTokens: 900,
      outputTokens: 120,
      reasoningTokens: 40,
      cachedInputTokens: 300,
      totalTokens: 1020
    }, { stepNumber: 1 });
    ledger.recordCompaction({
      estimatedTokens: 900,
      compactedTokens: 500,
      removedMessages: 6
    });

    const snapshot = ledger.snapshot();
    assert.equal(snapshot.provider.inputTokens, 900);
    assert.equal(snapshot.provider.outputTokens, 120);
    assert.equal(snapshot.provider.reasoningTokens, 40);
    assert.equal(snapshot.provider.cachedInputTokens, 300);
    assert.equal(snapshot.tools.callCount, 1);
    assert.equal(snapshot.tools.cacheReuseCount, 1);
    assert.ok(snapshot.estimated.toolSchemaTokens > 0);
    assert.ok(snapshot.estimated.toolArgumentTokens > 0);
    assert.ok(snapshot.estimated.toolResultTokens > 0);
    assert.equal(snapshot.compaction.removedTokens, 400);

    const sanitized = sanitizeTokenLedgerSnapshot(snapshot);
    assert.equal(sanitized.runId, "run-1");
    assert.equal(sanitized.provider.totalTokens, 1020);
  });

  it("persists a bounded ledger on assistant messages", () => {
    const message = sanitizeMessage({
      id: "assistant-1",
      role: "assistant",
      content: "done",
      status: "complete",
      createdAt: 1,
      tokenLedger: {
        runId: "run-1",
        provider: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        estimated: { toolSchemaTokens: 7, toolResultTokens: 8 },
        tools: { callCount: 2 },
        entries: Array.from({ length: 200 }, (_, index) => ({
          type: "tool_call",
          callId: `call-${index}`,
          at: index
        }))
      }
    });

    assert.equal(message.tokenLedger.runId, "run-1");
    assert.equal(message.tokenLedger.provider.totalTokens, 15);
    assert.equal(message.tokenLedger.entries.length, 160);
  });

  it("deduplicates Goal totals by run id", () => {
    const created = upsertGoal(null, {
      objective: "Build the scene",
      criteria: ["Tests pass"]
    }, {
      now: 10,
      createId: () => "goal-1"
    });
    const ledger = {
      runId: "run-1",
      provider: { totalTokens: 500, inputTokens: 400, outputTokens: 100 },
      estimated: { toolResultTokens: 80, totalInputTokens: 480 },
      tools: { callCount: 3, resultCount: 3, cacheReuseCount: 1 }
    };
    const first = recordGoalTokenUsage(created.goal, ledger, { now: 20 });
    const second = recordGoalTokenUsage(first.goal, ledger, { now: 30 });

    assert.equal(first.goal.usage.runCount, 1);
    assert.equal(first.goal.usage.provider.totalTokens, 500);
    assert.equal(first.goal.usage.tools.callCount, 3);
    assert.equal(second.changed, true);
    assert.equal(second.goal.usage.runCount, 1);
    assert.equal(second.goal.usage.provider.totalTokens, 500);
  });

  it("aggregates conversation runs without raw entry duplication", () => {
    const aggregate = aggregateTokenLedgers([
      {
        provider: { totalTokens: 10, requests: 1 },
        estimated: { toolResultTokens: 4 },
        tools: { callCount: 1 }
      },
      {
        provider: { totalTokens: 20, requests: 2 },
        estimated: { toolResultTokens: 6 },
        tools: { callCount: 2 }
      }
    ]);
    assert.equal(aggregate.runCount, 2);
    assert.equal(aggregate.provider.totalTokens, 30);
    assert.equal(aggregate.provider.requests, 3);
    assert.equal(aggregate.estimated.toolResultTokens, 10);
    assert.equal(aggregate.tools.callCount, 3);
  });
});
