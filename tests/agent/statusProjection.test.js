import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAgentStatus
} from "../../electron/agent/statusProjection.js";

test("public status keeps tool flow but removes raw diagnostics", () => {
  const projected = projectAgentStatus({
    activeToolCalls: [{
      id: "call-1",
      name: "read_file",
      title: "读取文件",
      status: "completed",
      input: {
        path: "src/App.jsx",
        secret: "do-not-send"
      },
      output: {
        content: "raw output"
      },
      result: {
        status: "success",
        summary: "读取完成",
        preview: "private preview"
      },
      meta: {
        token: "private"
      },
      runtime: {
        state: "reported",
        idempotencyKey: "secret-key"
      }
    }],
    activity: {
      events: [{
        id: "tool:1",
        type: "tool",
        tool: {
          id: "call-1",
          name: "read_file",
          status: "completed",
          input: {
            path: "src/App.jsx",
            secret: "do-not-send"
          },
          output: {
            content: "raw output"
          },
          result: {
            status: "success",
            summary: "读取完成"
          }
        }
      }, {
        id: "runtime:1",
        type: "status",
        status: "running",
        activityVisibility: "developer",
        title: "MODEL_STEP_STARTED"
      }]
    },
    toolRuntimeDiagnostics: {
      leases: [{ ownerId: "runtime-owner" }]
    }
  });

  assert.equal(projected.activeToolCalls.length, 1);
  assert.equal(projected.activeToolCalls[0].input.path, "src/App.jsx");
  assert.equal(projected.activeToolCalls[0].input.secret, undefined);
  assert.equal(projected.activeToolCalls[0].output, undefined);
  assert.equal(projected.activeToolCalls[0].meta, undefined);
  assert.equal(projected.activeToolCalls[0].result.summary, "读取完成");
  assert.equal(projected.activity.events.length, 1);
  assert.equal(projected.activity.events[0].type, "tool");
  assert.equal(projected.toolRuntimeDiagnostics, null);
});

test("developer status retains runtime diagnostics", () => {
  const source = {
    activeToolCalls: [{
      id: "call-1",
      input: { path: "a", secret: "kept-after-redaction-layer" },
      output: { content: "raw" }
    }],
    activity: { events: [] },
    toolRuntimeDiagnostics: { journalEntries: 10 }
  };

  assert.deepEqual(
    projectAgentStatus(source, { developerMode: true }),
    source
  );
});
