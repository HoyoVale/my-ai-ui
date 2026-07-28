import {
  sanitizeLegacyGoalSnapshot
} from "./legacyGoalSnapshot.js";

import {
  sanitizeLegacyExecutionSnapshot
} from "./legacyExecutionSnapshot.js";

const LEGACY_ADVANCED_VERSION = 1;


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
