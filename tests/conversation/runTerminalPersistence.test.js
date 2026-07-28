import { it } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeMessage
} from "../../electron/conversation/conversationSchema.js";

import {
  resolveRunTerminalPresentation
} from "../../electron/agent/RunTerminalPresentation.js";

it("persists one bounded terminal snapshot under Message metadata and Activity", () => {
  const terminal = resolveRunTerminalPresentation({
    outcome: "continuable",
    stopReason: "agent_step_limit",
    resumable: true
  });

  const message = sanitizeMessage({
    id: "assistant-1",
    role: "assistant",
    content: "当前进度已整理。",
    status: "complete",
    createdAt: 10,
    stopReason: "agent_step_limit",
    metadata: {
      run: {
        outcome: "continuable",
        phase: "checkpoint_ready",
        resumable: true,
        terminal: {
          ...terminal,
          stack: "private"
        }
      }
    },
    activity: {
      version: 3,
      taskId: "task-1",
      runId: "run-1",
      status: "checkpoint_ready",
      outcome: "continuable",
      stopReason: "agent_step_limit",
      resumable: true,
      terminal,
      startedAt: 1,
      endedAt: 10,
      durationMs: 9,
      events: []
    }
  }, 10);

  assert.equal(message.metadata.run.terminal.code, "step_limit");
  assert.equal(message.activity.terminal.code, "step_limit");
  assert.equal(message.metadata.run.terminal.resumable, true);
  assert.equal("stack" in message.metadata.run.terminal, false);
});
