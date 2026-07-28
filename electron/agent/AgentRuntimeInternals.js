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
  createCoreLiteCheckpointInstruction
} from "./CoreLiteCheckpoint.js";

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
    createCoreLiteCheckpointInstruction(
      continuation?.checkpoint
    ),
    [
      "[Continued task]",
      "Continue the same task using the saved task state above.",
      "Use the saved tool receipts and prior results. Do not repeat completed work unless verification is necessary.",
      `The user's latest instruction is: ${String(userInstruction ?? "").trim()}`,
      "Treat that instruction as guidance for the remaining work and continue from the saved checkpoint.",
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
      continuationState.continuationCount,
    checkpointVersion:
      continuationState.checkpointVersion,
    reportedReceiptCount:
      continuationState.reportedReceiptIds?.length ?? 0,
    resumedPartialResponse:
      Boolean(continuationState.partialResponse)
  };

  return context;
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
