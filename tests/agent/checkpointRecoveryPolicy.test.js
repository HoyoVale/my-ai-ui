import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CORE_LITE_RUN_CHECKPOINT_VERSION,
  createCoreLiteRunCheckpoint
} from "../../electron/agent/CoreLiteCheckpoint.js";

import {
  inspectCoreLiteCheckpointRecovery
} from "../../electron/agent/CoreLiteCheckpointRecovery.js";

function settingsFor({ rootPath, modelId = "deepseek-v4" } = {}) {
  return {
    workspaces: {
      items: rootPath
        ? [{
            id: "workspace-1",
            name: "Workspace",
            rootPath,
            canonicalPath: rootPath,
            createdAt: 1,
            lastOpenedAt: 1
          }]
        : []
    },
    model: {
      activeProvider: "deepseek",
      providers: {
        deepseek: {
          id: "deepseek",
          type: "deepseek",
          name: "DeepSeek",
          activeModelId: "main",
          models: [{
            id: "main",
            name: "Main",
            modelId
          }]
        }
      }
    }
  };
}

function checkpoint(rootPath, overrides = {}) {
  return createCoreLiteRunCheckpoint({
    taskId: "task-1",
    runId: "run-1",
    mode: "coding",
    workspaceId: "workspace-1",
    workspaceSnapshot: {
      id: "workspace-1",
      name: "Workspace",
      rootPath,
      canonicalPath: rootPath
    },
    modelSelection: {
      providerId: "deepseek",
      modelConfigId: "main"
    },
    modelSnapshot: {
      providerId: "deepseek",
      providerName: "DeepSeek",
      modelConfigId: "main",
      modelName: "Main",
      modelId: "deepseek-v4"
    },
    objective: "Continue the task",
    resumable: true,
    reportedReceiptIds: ["receipt-1"],
    partialResponse: "已完成第一部分。",
    partialResponseRole: "final",
    ...overrides
  });
}

describe("Core Lite checkpoint recovery policy", () => {
  it("accepts an unchanged workspace and model binding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-lite-44-"));
    try {
      const result = inspectCoreLiteCheckpointRecovery({
        checkpoint: checkpoint(root),
        settings: settingsFor({ rootPath: root })
      });

      assert.equal(result.ok, true);
      assert.equal(result.checkpointVersion, CORE_LITE_RUN_CHECKPOINT_VERSION);
      assert.deepEqual(result.reportedReceiptIds, ["receipt-1"]);
      assert.equal(result.partialResponse, "已完成第一部分。");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks continuation until uncertain Tool effects are resolved", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-lite-44-"));
    try {
      const result = inspectCoreLiteCheckpointRecovery({
        checkpoint: checkpoint(root, {
          unresolvedCallIds: ["call-1"],
          toolRuntime: {
            unresolvedCount: 1,
            needsConfirmation: 0,
            needsReconciliation: 1,
            calls: []
          }
        }),
        settings: settingsFor({ rootPath: root })
      });

      assert.equal(result.ok, false);
      assert.equal(result.code, "checkpoint-tool-reconciliation-required");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks a removed or repointed model configuration", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-lite-44-"));
    try {
      const removed = inspectCoreLiteCheckpointRecovery({
        checkpoint: checkpoint(root),
        settings: {
          ...settingsFor({ rootPath: root }),
          model: { activeProvider: "", providers: {} }
        }
      });
      assert.equal(removed.code, "checkpoint-model-unavailable");

      const changed = inspectCoreLiteCheckpointRecovery({
        checkpoint: checkpoint(root),
        settings: settingsFor({
          rootPath: root,
          modelId: "different-model"
        })
      });
      assert.equal(changed.code, "checkpoint-model-changed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks a missing or rebound Coding workspace", () => {
    const original = fs.mkdtempSync(path.join(os.tmpdir(), "core-lite-44-a-"));
    const rebound = fs.mkdtempSync(path.join(os.tmpdir(), "core-lite-44-b-"));
    try {
      const missing = inspectCoreLiteCheckpointRecovery({
        checkpoint: checkpoint(original),
        settings: settingsFor({ rootPath: null })
      });
      assert.equal(missing.code, "checkpoint-workspace-unavailable");

      const changed = inspectCoreLiteCheckpointRecovery({
        checkpoint: checkpoint(original),
        settings: settingsFor({ rootPath: rebound })
      });
      assert.equal(changed.code, "checkpoint-workspace-changed");
    } finally {
      fs.rmSync(original, { recursive: true, force: true });
      fs.rmSync(rebound, { recursive: true, force: true });
    }
  });

  it("rejects a modern checkpoint without a model binding", () => {
    const result = inspectCoreLiteCheckpointRecovery({
      checkpoint: createCoreLiteRunCheckpoint({
        taskId: "task-no-model",
        runId: "run-no-model",
        mode: "chat",
        objective: "Continue",
        resumable: true
      }),
      settings: settingsFor()
    });

    assert.equal(result.code, "checkpoint-model-binding-missing");
  });

  it("rejects future and non-resumable checkpoints", () => {
    const future = inspectCoreLiteCheckpointRecovery({
      checkpoint: {
        ...checkpoint(""),
        version: CORE_LITE_RUN_CHECKPOINT_VERSION + 1
      },
      settings: settingsFor()
    });
    assert.equal(future.code, "checkpoint-version-unsupported");

    const terminal = inspectCoreLiteCheckpointRecovery({
      checkpoint: checkpoint("", {
        mode: "chat",
        workspaceId: "",
        workspaceSnapshot: null,
        resumable: false
      }),
      settings: settingsFor()
    });
    assert.equal(terminal.code, "checkpoint-not-resumable");
  });
});
