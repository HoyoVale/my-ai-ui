import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentToolSession
} from "../../electron/tools/createAgentToolSession.js";

function settings(root, mode) {
  return {
    tools: {
      mode,
      workspace: { roots: [root] },
      runtime: {},
      developer: {
        toolsetOverrides: {},
        toolOverrides: {}
      },
      security: {
        approval: {
          localWrite: true,
          remoteWrite: true
        }
      }
    }
  };
}

test("Agent Session exposes requested tools plus bounded Agent support tools", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capability-session-"));
  const session = createAgentToolSession({
    settings: settings(root, "chat"),
    capabilityRequest: {
      requiredCapabilities: ["workspace.file.search"]
    }
  });

  try {
    assert.equal(session.capabilityResolution.satisfied, true);
    assert.deepEqual(Object.keys(session.tools).sort(), [
      "read_tool_result",
      "search_files",
      "search_text",
      "update_plan",
      "update_step_work"
    ]);
    assert.deepEqual(session.capabilityResolution.supportingCapabilities, [
      "agent.plan",
      "agent.result.page"
    ]);
  } finally {
    await session.closePersistence();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Capability requests cannot promote Chat to workspace write", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capability-chat-deny-"));
  const session = createAgentToolSession({
    settings: settings(root, "chat"),
    capabilityRequest: {
      requiredCapabilities: ["workspace.file.modify"],
      permissions: { workspaceWrite: "allow" }
    }
  });

  try {
    assert.equal(session.capabilityResolution.satisfied, false);
    assert.deepEqual(
      session.capabilityResolution.missingRequired,
      ["workspace.file.modify"]
    );
    assert.equal("write_text_file" in session.tools, false);
  } finally {
    await session.closePersistence();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
