import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAgentStatus,
  projectConversationStatus,
  projectResponseStatus,
  projectRuntimeRecovery
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


test("Response consumes a compact public projection", () => {
  const events = Array.from({ length: 36 }, (_, index) => ({
    id: `event-${index}`,
    sequence: index,
    type: "commentary",
    content: `step ${index}`
  }));
  const projected = projectResponseStatus({
    state: "running",
    runId: "run-compact",
    liveStepText: "stream",
    activeToolCalls: [{ id: "raw", input: { secret: "hidden" } }],
    activity: {
      status: "running",
      checkpoint: { rawContext: "must-not-cross-ipc" },
      events
    },
    orchestration: { raw: true },
    toolRuntimeDiagnostics: { journal: [1, 2, 3] }
  });

  assert.equal(projected.liveStepText, "stream");
  assert.equal(projected.activity.events.length, 30);
  assert.equal(projected.activity.events[0].id, "event-6");
  assert.equal(projected.activity.checkpoint, undefined);
  assert.equal(projected.activeToolCalls, undefined);
  assert.equal(projected.orchestration, undefined);
  assert.equal(projected.toolRuntimeDiagnostics, undefined);
});

test("Conversation receives a larger public projection without raw Tool fields", () => {
  const projected = projectConversationStatus({
    state: "running",
    runId: "run-conversation",
    activeToolCalls: [{
      id: "call-1",
      name: "workspace.read_file",
      input: { path: "README.md", apiKey: "secret" },
      output: { content: "raw" },
      runtime: { state: "reported", receiptId: "secret-receipt" }
    }],
    activity: { events: [] }
  });

  assert.equal(projected.activeToolCalls.length, 1);
  assert.equal(projected.activeToolCalls[0].input.path, "README.md");
  assert.equal(projected.activeToolCalls[0].input.apiKey, undefined);
  assert.equal(projected.activeToolCalls[0].output, undefined);
  assert.deepEqual(projected.activeToolCalls[0].runtime, {
    state: "reported",
    recoveryAction: ""
  });
});

test("public recovery projection exposes only fields required by recovery UI", () => {
  const projected = projectRuntimeRecovery({
    version: 2,
    totalCalls: 1,
    unresolvedCount: 1,
    needsConfirmation: 1,
    calls: [{
      callId: "call-1",
      toolName: "remote.write",
      state: "unknown",
      publicStatus: "需要确认",
      recovery: "needs_confirmation",
      effect: "remote_write",
      hasReceipt: false,
      actions: ["confirm_applied"],
      idempotencyKey: "private-key",
      lease: { ownerId: "private-owner" },
      receipt: { checksum: "private-checksum" }
    }]
  });

  assert.deepEqual(projected.calls[0], {
    callId: "call-1",
    toolName: "remote.write",
    state: "unknown",
    publicStatus: "需要确认",
    recovery: "needs_confirmation",
    effect: "remote_write",
    hasReceipt: false,
    actions: ["confirm_applied"]
  });
});

test("Conversation receives the bounded Tool Approval and security state", () => {
  const projected = projectConversationStatus({
    state: "running",
    pendingApproval: {
      id: "approval-1",
      runId: "run-1",
      callId: "call-1",
      toolName: "write_file",
      title: "写入文件",
      source: "builtin",
      effect: "local_write",
      reason: "需要确认",
      input: { path: "README.md", token: "[REDACTED]" },
      allowRunGrant: true,
      untrustedContent: false,
      queuedCount: 1
    },
    toolSecurity: {
      untrustedResults: 2,
      suspiciousResults: 1,
      promptInjectionSuspected: true,
      lastToolName: "mcp_search",
      lastSignals: ["private diagnostic signal"],
      lastDetectedAt: 123
    },
    activity: { events: [] }
  });

  assert.equal(projected.pendingApproval.id, "approval-1");
  assert.equal(projected.pendingApproval.input.path, "README.md");
  assert.equal(projected.pendingApproval.input.token, "[REDACTED]");
  assert.equal(projected.toolSecurity.suspiciousResults, 1);
  assert.equal(projected.toolSecurity.lastSignals, undefined);
});
