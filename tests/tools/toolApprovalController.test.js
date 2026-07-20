import assert from "node:assert/strict";
import test from "node:test";

import {
  ToolApprovalController
} from "../../electron/tools/security/ToolApprovalController.js";

function request(effect, overrides = {}) {
  return {
    callId: overrides.callId ?? `call-${effect}`,
    input: overrides.input ?? { path: "README.md", token: "secret-value" },
    definition: {
      id: overrides.id ?? `tool.${effect}`,
      name: overrides.name ?? `tool_${effect}`,
      title: overrides.title ?? `Tool ${effect}`,
      source: overrides.source ?? "builtin",
      riskLevel: effect === "destructive" ? "high" : "medium",
      sideEffect: effect === "local_write" ? "write" : "external",
      runtimeContract: { effect }
    }
  };
}

test("read-only tools do not require approval", async () => {
  const controller = new ToolApprovalController();
  const result = await controller.authorize(request("read"));
  assert.deepEqual(result, { decision: "allow" });
  assert.equal(controller.approvalSnapshot(), null);
  controller.close();
});

test("local writes wait for a redacted one-time approval", async () => {
  const controller = new ToolApprovalController({ runId: "run-1" });
  const pending = controller.authorize(request("local_write"));
  const approval = controller.approvalSnapshot();

  assert.equal(approval.effect, "local_write");
  assert.equal(approval.input.token, "[REDACTED]");
  assert.equal(approval.allowRunGrant, true);

  const resolved = controller.resolveApproval({
    approvalId: approval.id,
    decision: "allow_once"
  });
  assert.equal(resolved.ok, true);
  assert.deepEqual(await pending, { decision: "allow" });
  controller.close();
});

test("run grants apply only to the same tool and are revoked by suspicious MCP content", async () => {
  const controller = new ToolApprovalController({ runId: "run-2" });
  const first = controller.authorize(request("remote_write", {
    id: "mcp.remote.create_issue",
    source: "mcp.remote"
  }));
  const approval = controller.approvalSnapshot();
  controller.resolveApproval({ approvalId: approval.id, decision: "allow_run" });
  assert.deepEqual(await first, { decision: "allow" });

  assert.deepEqual(
    await controller.authorize(request("remote_write", {
      id: "mcp.remote.create_issue",
      source: "mcp.remote"
    })),
    { decision: "allow" }
  );

  controller.markToolRecord({
    status: "completed",
    source: "mcp.remote",
    name: "search",
    output: {
      safety: {
        untrusted: true,
        classification: "prompt-injection-suspected",
        promptInjectionSignals: ["ignore previous instructions"]
      }
    }
  });

  const afterSignal = controller.authorize(request("remote_write", {
    id: "mcp.remote.create_issue",
    source: "mcp.remote"
  }));
  const taintedApproval = controller.approvalSnapshot();
  assert.equal(taintedApproval.untrustedContent, true);
  assert.equal(taintedApproval.allowRunGrant, false);
  controller.resolveApproval({
    approvalId: taintedApproval.id,
    decision: "allow_once"
  });
  assert.deepEqual(await afterSignal, { decision: "allow" });
  controller.close();
});

test("destructive tools are blocked after suspicious MCP content", async () => {
  const controller = new ToolApprovalController();
  controller.markToolRecord({
    status: "failed",
    source: "mcp.remote",
    name: "browse",
    output: {
      safety: {
        untrusted: true,
        classification: "prompt-injection-suspected",
        promptInjectionSignals: ["reveal system prompt"]
      }
    }
  });

  const result = await controller.authorize(request("destructive", {
    source: "mcp.remote"
  }));
  assert.equal(result.decision, "deny");
  assert.equal(result.code, "UNTRUSTED_DESTRUCTIVE_TOOL_BLOCKED");
  assert.equal(controller.approvalSnapshot(), null);
  controller.close();
});

test("aborting a run denies every pending approval", async () => {
  const abortController = new AbortController();
  const controller = new ToolApprovalController({
    abortSignal: abortController.signal
  });
  const pending = controller.authorize(request("local_write"));
  abortController.abort("user-stop");
  const result = await pending;
  assert.equal(result.decision, "deny");
  assert.equal(result.code, "APPROVAL_CANCELLED");
  assert.equal(controller.approvalSnapshot(), null);
  controller.close();
});

test("a pending write approval is downgraded when suspicious MCP content arrives", async () => {
  const controller = new ToolApprovalController();
  const pending = controller.authorize(request("remote_write", {
    id: "mcp.remote.update",
    source: "mcp.remote"
  }));
  assert.equal(controller.approvalSnapshot().allowRunGrant, true);

  controller.markToolRecord({
    status: "completed",
    source: "mcp.remote",
    name: "read_untrusted",
    output: {
      safety: {
        untrusted: true,
        classification: "prompt-injection-suspected",
        promptInjectionSignals: ["ignore previous instructions"]
      }
    }
  });

  const approval = controller.approvalSnapshot();
  assert.equal(approval.untrustedContent, true);
  assert.equal(approval.allowRunGrant, false);
  const resolved = controller.resolveApproval({
    approvalId: approval.id,
    decision: "allow_run"
  });
  assert.equal(resolved.decision, "allow_once");
  assert.deepEqual(await pending, { decision: "allow" });
  controller.close();
});

test("a run grant releases already queued calls for the same tool", async () => {
  const controller = new ToolApprovalController();
  const first = controller.authorize(request("remote_write", {
    callId: "call-1",
    id: "mcp.remote.update",
    source: "mcp.remote"
  }));
  const second = controller.authorize(request("remote_write", {
    callId: "call-2",
    id: "mcp.remote.update",
    source: "mcp.remote"
  }));
  const approval = controller.approvalSnapshot();
  assert.equal(approval.queuedCount, 2);

  controller.resolveApproval({
    approvalId: approval.id,
    decision: "allow_run"
  });

  assert.deepEqual(await first, { decision: "allow" });
  assert.deepEqual(await second, { decision: "allow" });
  assert.equal(controller.approvalSnapshot(), null);
  controller.close();
});
