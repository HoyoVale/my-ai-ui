import path from "node:path";

import {
  getConversationPath
} from "../conversation/index.js";

import {
  getSettings
} from "../settings/settingsStore.js";

import {
  resolveActiveModelSettings
} from "../settings/modelSettings.js";

import {
  getCredentialError
} from "./modelFactory.js";

import {
  createCheckpointInstruction
} from "./runCheckpoint.js";

import {
  classifyLatestToolFailure
} from "./runStopReasons.js";

import {
  RunStateMachine
} from "./RunStateMachine.js";

export function getActiveCredentialError(modelConfig = null) {
  try {
    const modelSettings =
      resolveActiveModelSettings(
        modelConfig ?? getSettings().model
      );

    return getCredentialError(
      modelSettings
    );
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }
}

export function appendTaskContinuationToContext(
  context,
  continuation,
  continuationState,
  userInstruction
) {
  if (!continuationState) {
    return context;
  }

  const runtimeInstruction = [
    createCheckpointInstruction(
      continuation?.checkpoint
    ),
    [
      "[Continued task]",
      "Continue the same task using the saved task state above.",
      "Keep completed plan steps and prior tool results. Do not repeat completed work unless verification is necessary.",
      `The user's latest instruction is: ${String(userInstruction ?? "").trim()}`,
      "Treat that instruction as guidance for the remaining work. Replan only when it materially changes the unfinished steps.",
      "Do not tell the user about internal execution slices, counters, budgets, limits, saved-state mechanics, or runtime stop reasons."
    ].join("\n")
  ].filter(Boolean).join("\n\n");

  context.runtimeInstructions = [
    context.runtimeInstructions,
    runtimeInstruction
  ].filter(Boolean).join("\n\n");
  context.system = [
    context.system,
    runtimeInstruction
  ].filter(Boolean).join("\n\n");

  context.metadata = {
    ...context.metadata,
    continuedTask: true,
    taskId: continuationState.taskId,
    parentRunId: continuationState.parentRunId,
    resumedFromMessageId:
      continuationState.resumedFromMessageId,
    continuationCount:
      continuationState.continuationCount
  };

  return context;
}

export function classifyWorkingInstruction(message) {
  const value = String(message ?? "").trim();
  if (!value) return {};
  return {
    ...(/(?:视觉|截图|画面|外观|摄像机|相机|光晕|吸积盘|黑洞|visual|screenshot|camera|render)/iu.test(value)
      ? { latestVisualFeedback: value.slice(0, 1000) }
      : {}),
    ...(/(?:npm\s+(?:run\s+)?test|测试|tests?\s+(?:pass|fail)|test\s+result)/iu.test(value)
      ? { latestTestResult: value.slice(0, 1000) }
      : {}),
    ...(/(?:npm\s+run\s+build|构建|编译|打包|build\s+(?:pass|fail)|build\s+result)/iu.test(value)
      ? { latestBuildResult: value.slice(0, 1000) }
      : {})
  };
}

export function deriveGoalWorkingState(activeRun) {
  if (!activeRun) return null;

  const planState = activeRun.toolSession?.getPlanState?.() ??
    activeRun.initialPlanState ??
    activeRun.initialPlan ??
    [];
  const rootItems = Array.isArray(planState)
    ? planState
    : Array.isArray(planState?.rootItems)
      ? planState.rootItems
      : [];
  const records = activeRun.toolSession?.getRecords?.() ??
    activeRun.toolCalls ??
    [];
  const modifiedFiles = new Set(
    activeRun.workingState?.modifiedFiles ?? []
  );
  const fingerprints = new Map(
    (activeRun.workingState?.fileFingerprints ?? [])
      .map((item) => [item.path, item])
  );
  const recentToolFailures = [];

  for (const record of records) {
    const input = record?.input ?? {};
    const output = record?.output?.data ?? record?.result?.data ?? {};
    const toolName = String(record?.name ?? "");
    const pathValue = String(
      output?.path ??
      input?.path ??
      input?.filePath ??
      ""
    ).trim();

    if (
      record?.status === "completed" &&
      [
        "write_text_file",
        "replace_text_in_file",
        "apply_patch",
        "delete_path",
        "move_path"
      ].includes(toolName) &&
      pathValue
    ) {
      modifiedFiles.add(pathValue);
    }

    if (
      record?.status === "completed" &&
      ["read_text_file", "inspect_path", "compute_file_hash"].includes(toolName) &&
      pathValue &&
      output?.sha256
    ) {
      fingerprints.set(pathValue, {
        path: pathValue,
        hash: String(output.sha256),
        updatedAt: Date.now()
      });
    }

    const error = record?.result?.error ?? record?.output?.error;
    if (record?.status === "failed" && error) {
      recentToolFailures.push({
        code: String(error.code ?? ""),
        message: String(error.message ?? ""),
        toolName,
        recoverable:
          classifyLatestToolFailure([record]).recoverable,
        at: Number(record.endedAt ?? Date.now())
      });
    }
  }

  const activeStep = rootItems.find((item) => item.status === "in_progress");
  const completedStepIds = rootItems
    .filter((item) => item.status === "completed")
    .map((item) => item.id);
  const unresolvedProblems = rootItems
    .filter((item) => ["blocked", "needs_input"].includes(item.status))
    .map((item) => item.reason || item.title)
    .filter(Boolean);

  return {
    ...(activeRun.workingState ?? {}),
    objective: activeRun.objective ?? "",
    lastUserInstruction: activeRun.continuationInstruction ?? "",
    activeStepId: activeStep?.id ?? null,
    completedStepIds,
    modifiedFiles: [...modifiedFiles],
    fileFingerprints: [...fingerprints.values()],
    recentToolFailures: [
      ...(activeRun.workingState?.recentToolFailures ?? []),
      ...recentToolFailures
    ],
    unresolvedProblems,
    lastCheckpointId:
      activeRun.activityStore?.getCheckpoint?.()?.id ??
      activeRun.workingState?.lastCheckpointId ??
      null,
    lastRunId: activeRun.runId,
    lastRunSummary:
      activeRun.finalText ||
      activeRun.publicStatus ||
      activeRun.workingState?.lastRunSummary ||
      "",
    nextRecommendedAction:
      activeStep?.title ??
      rootItems.find((item) => item.status === "pending")?.title ??
      "",
    updatedAt: Date.now()
  };
}

export function getTaskResultDirectory(taskId) {
  const safeTaskId = String(taskId ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);

  if (!safeTaskId) {
    return "";
  }

  try {
    return path.join(
      path.dirname(getConversationPath()),
      "tool-results",
      safeTaskId
    );
  } catch {
    return "";
  }
}

export async function settleResultValue(
  value,
  fallback
) {
  try {
    return await value;
  } catch {
    return fallback;
  }
}

export function createRunStateFields(startedAt) {
  const stateMachine = new RunStateMachine({
    startedAt
  });
  const state = stateMachine.snapshot();

  return {
    stateMachine,
    phase: state.phase,
    outcome: state.outcome,
    executionStopReason: state.executionStopReason || null,
    stopReason: state.executionStopReason || null,
    resumable: state.resumable,
    publicStatus: state.messageStatus
  };
}

