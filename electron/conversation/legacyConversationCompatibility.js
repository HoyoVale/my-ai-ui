import {
  sanitizeLegacyGoalSnapshot
} from "./legacyGoalSnapshot.js";

import {
  sanitizeLegacyExecutionSnapshot
} from "./legacyExecutionSnapshot.js";

const LEGACY_ADVANCED_VERSION = 1;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function metadataSource(source) {
  return source?.metadata?.legacyAdvanced &&
    typeof source.metadata.legacyAdvanced === "object"
    ? source.metadata.legacyAdvanced
    : null;
}

function executionSource(source, legacy) {
  if (legacy?.execution && typeof legacy.execution === "object") {
    return legacy.execution;
  }
  return legacy ?? source ?? {};
}

export function sanitizeLegacyAdvancedMetadata(source) {
  if (!source || typeof source !== "object") return null;

  const legacy = metadataSource(source);
  const goal = sanitizeLegacyGoalSnapshot(legacy?.goal ?? source.goal);
  const execution = sanitizeLegacyExecutionSnapshot(
    executionSource(source, legacy)
  );

  const hasExecution =
    execution.executionThreads.length > 0 ||
    execution.routingDecisions.length > 0;

  if (!goal && !hasExecution) return null;

  return {
    version: LEGACY_ADVANCED_VERSION,
    readOnly: true,
    goal,
    execution: {
      activeExecutionThreadId: execution.activeExecutionThreadId,
      executionThreads: execution.executionThreads,
      routingDecisions: execution.routingDecisions
    }
  };
}

export function getLegacyAdvancedMetadata(conversation) {
  return sanitizeLegacyAdvancedMetadata(conversation);
}

export function projectLegacyConversationFields(conversation) {
  if (!conversation || typeof conversation !== "object") return conversation;

  const projected = clone(conversation);
  const legacy = getLegacyAdvancedMetadata(conversation);
  const execution = legacy?.execution ?? {
    activeExecutionThreadId: null,
    executionThreads: [],
    routingDecisions: []
  };
  const activeExecutionThreadId = execution.activeExecutionThreadId ?? null;
  const executionThreads = clone(execution.executionThreads ?? []);

  projected.goal = clone(legacy?.goal ?? null);
  projected.activeExecutionThreadId = activeExecutionThreadId;
  projected.executionThreads = executionThreads;
  projected.executionThread = executionThreads.find(
    (thread) => thread.id === activeExecutionThreadId
  ) ?? null;
  projected.routingDecisions = clone(execution.routingDecisions ?? []);
  projected.legacyAdvancedReadOnly = Boolean(legacy);

  return projected;
}
