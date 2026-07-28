import fs from "node:fs";
import path from "node:path";

import {
  resolveModelBinding
} from "../conversation/sessionContext.js";

import {
  CORE_LITE_RUN_CHECKPOINT_VERSION
} from "./CoreLiteCheckpoint.js";

function string(value) {
  return String(value ?? "").trim();
}

function normalizeComparablePath(value) {
  const normalized = path.normalize(string(value));
  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function workspaceById(settings, workspaceId) {
  const items = Array.isArray(settings?.workspaces?.items)
    ? settings.workspaces.items
    : [];
  const source = items.find(
    (item) => string(item?.id) === workspaceId
  );
  if (!source) {
    return null;
  }
  const rootPath = string(source.rootPath ?? source.canonicalPath);
  const canonicalPath = string(source.canonicalPath ?? rootPath);
  return {
    ...structuredClone(source),
    rootPath,
    canonicalPath,
    missing: !rootPath || !fs.existsSync(rootPath)
  };
}

function failure(code, message, details = {}) {
  return {
    ok: false,
    code,
    message,
    resumable: false,
    details: structuredClone(details)
  };
}

function unresolvedRecovery(checkpoint) {
  const runtime = checkpoint?.toolRuntime ?? {};
  const unresolvedCallIds = Array.isArray(checkpoint?.unresolvedCallIds)
    ? checkpoint.unresolvedCallIds.filter(Boolean)
    : [];
  const needsConfirmation = Math.max(
    0,
    Number(runtime.needsConfirmation) || 0
  );
  const needsReconciliation = Math.max(
    0,
    Number(runtime.needsReconciliation) || 0
  );
  const unresolvedCount = Math.max(
    unresolvedCallIds.length,
    Number(runtime.unresolvedCount) || 0,
    needsConfirmation + needsReconciliation
  );

  return {
    unresolvedCallIds,
    unresolvedCount,
    needsConfirmation,
    needsReconciliation
  };
}

function validateWorkspace(checkpoint, settings) {
  if (checkpoint.mode !== "coding") {
    return { ok: true, workspace: null };
  }

  const workspaceId = string(checkpoint.workspaceId);
  if (!workspaceId) {
    return failure(
      "checkpoint-workspace-required",
      "该 Coding 任务的检查点没有绑定工作区，无法安全续跑。"
    );
  }

  const workspace = workspaceById(settings, workspaceId);
  if (!workspace || workspace.missing) {
    return failure(
      "checkpoint-workspace-unavailable",
      workspace?.missing
        ? "原工作区目录已不存在，请重新添加后再继续。"
        : "原工作区已从设置中移除，无法继续该任务。",
      { workspaceId }
    );
  }

  const savedPath = normalizeComparablePath(
    checkpoint.workspaceSnapshot?.canonicalPath ??
      checkpoint.workspaceSnapshot?.rootPath
  );
  const currentPath = normalizeComparablePath(
    workspace.canonicalPath ?? workspace.rootPath
  );

  if (savedPath && currentPath && savedPath !== currentPath) {
    return failure(
      "checkpoint-workspace-changed",
      "原工作区绑定已指向不同目录。为避免在错误目录继续写入，本次续跑已阻止。",
      {
        workspaceId,
        savedPath,
        currentPath
      }
    );
  }

  return {
    ok: true,
    workspace: {
      id: workspace.id,
      canonicalPath: currentPath
    }
  };
}

function validateModel(checkpoint, settings, version) {
  const selection = checkpoint.modelSelection;
  if (!selection || typeof selection !== "object") {
    if (version >= 5) {
      return failure(
        "checkpoint-model-binding-missing",
        "检查点缺少原模型绑定，无法保证续跑使用同一模型。"
      );
    }
    return { ok: true, model: null, legacyBinding: true };
  }

  const binding = resolveModelBinding(settings?.model ?? {}, selection);
  if (!binding.selection || !binding.snapshot) {
    return failure(
      "checkpoint-model-unavailable",
      "该任务原来使用的模型已被移除，请恢复该模型配置后再继续。",
      { selection }
    );
  }

  const saved = checkpoint.modelSnapshot;
  if (saved && typeof saved === "object") {
    const identityFields = [
      "providerId",
      "modelConfigId",
      "modelId"
    ];
    const changedFields = identityFields.filter((field) => {
      const previous = string(saved[field]);
      const current = string(binding.snapshot[field]);
      return previous && current && previous !== current;
    });

    if (changedFields.length > 0) {
      return failure(
        "checkpoint-model-changed",
        "原模型配置现在指向了不同的底层模型。为保证续跑上下文一致，本次续跑已阻止。",
        {
          selection: binding.selection,
          changedFields,
          savedSnapshot: saved,
          currentSnapshot: binding.snapshot
        }
      );
    }
  }

  return {
    ok: true,
    model: {
      selection: binding.selection,
      snapshot: binding.snapshot
    },
    legacyBinding: !saved
  };
}

export function inspectCoreLiteCheckpointRecovery({
  checkpoint,
  settings
} = {}) {
  if (!checkpoint || typeof checkpoint !== "object") {
    return failure(
      "checkpoint-invalid",
      "找不到可继续的检查点。"
    );
  }

  const version = Math.max(1, Number(checkpoint.version) || 1);
  if (version > CORE_LITE_RUN_CHECKPOINT_VERSION) {
    return failure(
      "checkpoint-version-unsupported",
      "该检查点来自更高版本的 Runtime，当前版本无法安全读取。",
      {
        checkpointVersion: version,
        supportedVersion: CORE_LITE_RUN_CHECKPOINT_VERSION
      }
    );
  }

  if (
    checkpoint.runtimeFlavor &&
    checkpoint.runtimeFlavor !== "core-lite"
  ) {
    return failure(
      "checkpoint-runtime-unsupported",
      "该检查点不属于 Core Lite Runtime，无法继续。"
    );
  }

  if (!string(checkpoint.taskId) || !string(checkpoint.runId)) {
    return failure(
      "checkpoint-identity-missing",
      "检查点缺少任务或运行标识，无法可靠续跑。"
    );
  }

  if (checkpoint.resumable !== true) {
    return failure(
      "checkpoint-not-resumable",
      "该任务已经结束，不能从此检查点继续。"
    );
  }

  const unresolved = unresolvedRecovery(checkpoint);
  if (unresolved.unresolvedCount > 0) {
    const confirmationOnly =
      unresolved.needsConfirmation > 0 &&
      unresolved.needsReconciliation === 0;
    return failure(
      confirmationOnly
        ? "checkpoint-tool-confirmation-required"
        : "checkpoint-tool-reconciliation-required",
      confirmationOnly
        ? "有工具操作需要先确认是否已生效，确认后才能继续任务。"
        : "有工具操作的最终状态尚未核验，请先完成核验后再继续任务。",
      unresolved
    );
  }

  const workspace = validateWorkspace(checkpoint, settings);
  if (!workspace.ok) {
    return workspace;
  }

  const model = validateModel(checkpoint, settings, version);
  if (!model.ok) {
    return model;
  }

  return {
    ok: true,
    code: "checkpoint-ready",
    resumable: true,
    checkpointVersion: version,
    workspace: workspace.workspace,
    model: model.model,
    legacyModelBinding: model.legacyBinding === true,
    reportedReceiptIds: Array.isArray(checkpoint.reportedReceiptIds)
      ? [...new Set(checkpoint.reportedReceiptIds.map(string).filter(Boolean))]
      : [],
    partialResponse: String(checkpoint.partialResponse ?? ""),
    partialResponseRole: ["none", "commentary", "final"].includes(
      checkpoint.partialResponseRole
    )
      ? checkpoint.partialResponseRole
      : "none"
  };
}
