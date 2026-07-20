import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentToolSession
} from "../../electron/tools/createAgentToolSession.js";
import {
  ToolApprovalController
} from "../../electron/tools/security/ToolApprovalController.js";

function securitySettings() {
  return {
    approval: {
      localWrite: true,
      remoteWrite: true,
      allowRunGrant: true,
      timeoutMs: 300_000
    },
    untrustedContent: {
      requirePerCallApproval: true,
      blockDestructive: true
    }
  };
}

async function waitForApproval(controller, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const approval = controller.approvalSnapshot();
    if (approval) {
      return approval;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  throw new Error("Tool approval did not become pending.");
}

test("thirty approved Coding writes complete without leaking approval state", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "xixi-tool-write-soak-")
  );
  const abortController = new AbortController();
  const controller = new ToolApprovalController({
    runId: "run-write-soak",
    taskId: "task-write-soak",
    settings: {
      tools: {
        security: securitySettings()
      }
    },
    abortSignal: abortController.signal
  });
  const session = createAgentToolSession({
    activeModel: { provider: "test" },
    taskId: "task-write-soak",
    runId: "run-write-soak",
    workspaceId: "workspace-write-soak",
    mode: "coding",
    settings: {
      tools: {
        mode: "coding",
        runtime: {
          maxToolCalls: 100,
          maxToolCallsPerStep: 64,
          maxToolCallsPerBatch: 64,
          maxTotalToolCalls: 100,
          maxIdenticalCalls: 3
        },
        workspace: { roots: [root] },
        security: securitySettings(),
        developer: {
          toolsetOverrides: {},
          toolOverrides: {}
        }
      }
    },
    abortSignal: abortController.signal,
    authorizeTool: (request) => controller.authorize(request)
  });

  try {
    for (let index = 0; index < 30; index += 1) {
      const relativePath = `approved-${index}.txt`;
      const content = `approved write ${index}\n`;
      const execution = session.tools.write_text_file.execute(
        {
          path: relativePath,
          content
        },
        {
          toolCallId: `write-soak-${index}`
        }
      );
      const approval = await waitForApproval(controller).catch((error) => {
        error.message = `${error.message} index=${index}`;
        throw error;
      });

      assert.equal(
        fs.existsSync(path.join(root, relativePath)),
        false,
        "No write may occur before its matching approval."
      );
      assert.equal(approval.toolName, "write_text_file");
      assert.equal(
        controller.resolveApproval({
          approvalId: approval.id,
          decision: "allow_once"
        }).ok,
        true
      );

      const result = await execution;
      assert.equal(result.ok, true);
      assert.equal(
        fs.readFileSync(path.join(root, relativePath), "utf8"),
        content
      );
      assert.equal(controller.approvalSnapshot(), null);
    }

    assert.equal(
      session.getRecords().filter(
        (record) => record.name === "write_text_file" && record.status === "completed"
      ).length,
      30
    );
  } finally {
    controller.close();
    await session.closePersistence();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
