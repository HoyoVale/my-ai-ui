export const RUN_STOP_REASONS = Object.freeze({
  COMPLETED: "completed",
  CANCELLED_BY_USER: "cancelled_by_user",
  INTERRUPTED: "interrupted",
  WAITING_FOR_USER: "waiting_for_user",
  NEEDS_INPUT: "needs_input",
  BLOCKED: "blocked",
  TOOL_CALL_LIMIT: "tool_call_limit",
  AGENT_STEP_LIMIT: "agent_step_limit",
  AGENT_SEGMENT_LIMIT: "agent_segment_limit",
  NO_PROGRESS: "no_progress",
  AGENT_RUN_TIMEOUT: "agent_run_timeout",
  TOOL_TIMEOUT: "tool_timeout",
  REPEATED_TOOL_CALL: "repeated_tool_call",
  TOOL_ERROR: "tool_error",
  MODEL_ERROR: "model_error",
  INVALID_TOOL_ARGUMENTS: "invalid_tool_arguments",
  PERMISSION_DENIED: "permission_denied",
  OUTPUT_LIMIT: "output_limit",
  CONTENT_FILTER: "content_filter",
  PLAN_INCOMPLETE: "plan_incomplete",
  UNKNOWN: "unknown"
});

const LEGACY_ALIASES = Object.freeze({
  user_input_required:
    RUN_STOP_REASONS.WAITING_FOR_USER,
  step_limit:
    RUN_STOP_REASONS.AGENT_STEP_LIMIT,
  run_timeout:
    RUN_STOP_REASONS.AGENT_RUN_TIMEOUT,
  repeated_call:
    RUN_STOP_REASONS.REPEATED_TOOL_CALL,
  aborted:
    RUN_STOP_REASONS.CANCELLED_BY_USER,
  interrupted:
    RUN_STOP_REASONS.INTERRUPTED,
  error:
    RUN_STOP_REASONS.MODEL_ERROR
});

const TOOL_ERROR_REASON = Object.freeze({
  AGENT_RUN_TIMEOUT:
    RUN_STOP_REASONS.AGENT_RUN_TIMEOUT,
  TOOL_CALL_LIMIT:
    RUN_STOP_REASONS.TOOL_CALL_LIMIT,
  TOOL_TIMEOUT:
    RUN_STOP_REASONS.TOOL_TIMEOUT,
  REPEATED_TOOL_CALL:
    RUN_STOP_REASONS.REPEATED_TOOL_CALL,
  INVALID_TOOL_ARGUMENTS:
    RUN_STOP_REASONS.INVALID_TOOL_ARGUMENTS,
  PERMISSION_DENIED:
    RUN_STOP_REASONS.PERMISSION_DENIED,
  CANCELLED_BY_USER:
    RUN_STOP_REASONS.CANCELLED_BY_USER,
  PLAN_STEP_REQUIRED:
    RUN_STOP_REASONS.PLAN_INCOMPLETE,
  TIMEOUT:
    RUN_STOP_REASONS.TOOL_TIMEOUT,
  INVALID_ARGUMENTS:
    RUN_STOP_REASONS.INVALID_TOOL_ARGUMENTS,
  NOT_FOUND:
    RUN_STOP_REASONS.TOOL_ERROR,
  TEMPORARY_FAILURE:
    RUN_STOP_REASONS.TOOL_ERROR,
  CANCELLED:
    RUN_STOP_REASONS.CANCELLED_BY_USER
});

const KNOWN_REASONS = new Set(
  Object.values(RUN_STOP_REASONS)
);

export function normalizeRunStopReason(
  value,
  fallback = RUN_STOP_REASONS.UNKNOWN
) {
  const normalized = String(
    value ?? ""
  ).trim();

  if (KNOWN_REASONS.has(normalized)) {
    return normalized;
  }

  return LEGACY_ALIASES[normalized] ?? fallback;
}

export function runStatusFromStopReason(
  value
) {
  const reason = normalizeRunStopReason(
    value
  );

  if (reason === RUN_STOP_REASONS.COMPLETED) {
    return "completed";
  }

  if (
    reason ===
    RUN_STOP_REASONS.WAITING_FOR_USER
  ) {
    return "waiting_for_user";
  }

  if (reason === RUN_STOP_REASONS.NEEDS_INPUT) {
    return "needs_input";
  }

  if (reason === RUN_STOP_REASONS.BLOCKED) {
    return "blocked";
  }

  if (
    reason ===
    RUN_STOP_REASONS.CANCELLED_BY_USER
  ) {
    return "cancelled";
  }

  if (
    reason ===
    RUN_STOP_REASONS.INTERRUPTED
  ) {
    return "interrupted";
  }

  if (reason === RUN_STOP_REASONS.UNKNOWN) {
    return "unknown";
  }

  return "failed";
}

export function stopReasonFromToolRecords(
  records = []
) {
  const latestError = [...records]
    .reverse()
    .find((record) => {
      const error =
        record?.result?.error ??
        record?.output?.error;

      return Boolean(
        error?.code &&
        error?.retryable !== true
      );
    });

  const code =
    latestError?.result?.error?.code ??
    latestError?.output?.error?.code ??
    "";

  if (TOOL_ERROR_REASON[code]) {
    return TOOL_ERROR_REASON[code];
  }

  return latestError
    ? RUN_STOP_REASONS.TOOL_ERROR
    : "";
}

export function inferRunStopReason({
  pendingQuestion,
  records = [],
  finishReason,
  steps = [],
  maxSteps = 0,
  plan = []
} = {}) {
  if (pendingQuestion) {
    return RUN_STOP_REASONS.WAITING_FOR_USER;
  }


  const needsInput =
    Array.isArray(plan) &&
    plan.some((item) => item?.status === "needs_input");

  if (needsInput) {
    return RUN_STOP_REASONS.NEEDS_INPUT;
  }
  const toolReason = stopReasonFromToolRecords(
    records
  );

  if (toolReason) {
    return toolReason;
  }

  if (
    Array.isArray(steps) &&
    maxSteps > 0 &&
    steps.length >= maxSteps &&
    finishReason === "tool-calls"
  ) {
    return RUN_STOP_REASONS.AGENT_STEP_LIMIT;
  }

  if (finishReason === "length") {
    return RUN_STOP_REASONS.OUTPUT_LIMIT;
  }

  if (finishReason === "content-filter") {
    return RUN_STOP_REASONS.CONTENT_FILTER;
  }

  if (finishReason === "error") {
    return RUN_STOP_REASONS.MODEL_ERROR;
  }

  const blockedPlan =
    Array.isArray(plan) &&
    plan.some((item) => item?.status === "blocked");

  if (blockedPlan) {
    return RUN_STOP_REASONS.BLOCKED;
  }

  const unfinishedPlan =
    Array.isArray(plan) &&
    plan.some((item) =>
      [
        "pending",
        "in_progress"
      ].includes(item?.status)
    );

  if (unfinishedPlan) {
    return RUN_STOP_REASONS.PLAN_INCOMPLETE;
  }

  return RUN_STOP_REASONS.COMPLETED;
}
