export const TOOL_ERROR_TYPES = Object.freeze({
  INVALID_ARGUMENTS:
    "INVALID_ARGUMENTS",
  TIMEOUT: "TIMEOUT",
  PERMISSION_DENIED:
    "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  TEMPORARY_FAILURE:
    "TEMPORARY_FAILURE",
  CANCELLED: "CANCELLED",
  RESULT_TOO_LARGE:
    "RESULT_TOO_LARGE",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  POLICY_DENIED: "POLICY_DENIED",
  INVALID_OUTPUT: "INVALID_OUTPUT",
  EXECUTION_FAILED:
    "EXECUTION_FAILED"
});

const TEMPORARY_CODES = new Set([
  "EAGAIN",
  "EBUSY",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "EMFILE",
  "ENFILE",
  "ENETDOWN",
  "ENETUNREACH",
  "ETIMEDOUT",
  "TEMPORARY_FAILURE"
]);

const PERMISSION_CODES = new Set([
  "EACCES",
  "EPERM",
  "PERMISSION_DENIED"
]);

const NOT_FOUND_CODES = new Set([
  "ENOENT",
  "NOT_FOUND",
  "TOOL_RESULT_NOT_FOUND"
]);

const INVALID_CODES = new Set([
  "EINVAL",
  "INVALID_ARGUMENTS",
  "INVALID_TOOL_ARGUMENTS",
  "PLAN_STEP_REQUIRED"
]);

const POLICY_CODES = new Set([
  "PATH_OUTSIDE_WORKSPACE",
  "SENSITIVE_PATH_BLOCKED",
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
  "ASK_USER_ALREADY_ANSWERED",
  "ASK_USER_MUST_ADVANCE",
  "ASK_USER_LIMIT"
]);

const CONFLICT_CODES = new Set([
  "EEXIST",
  "CONFLICT",
  "VERSION_CONFLICT"
]);

const RATE_LIMIT_CODES = new Set([
  "RATE_LIMITED",
  "RATE_LIMIT",
  "TOO_MANY_REQUESTS"
]);

const INVALID_OUTPUT_CODES = new Set([
  "INVALID_TOOL_OUTPUT",
  "NON_SERIALIZABLE_OUTPUT"
]);

function messageOf(value) {
  return String(
    value?.error?.message ??
    value?.message ??
    value ??
    "工具执行失败。"
  );
}

function codeOf(value) {
  return String(
    value?.error?.code ??
    value?.code ??
    ""
  ).trim();
}

export function classifyToolError(
  value,
  {
    abortSignal = null,
    retryable = undefined
  } = {}
) {
  const code = codeOf(value);
  const abortedForTimeout = [
    "TOOL_TIMEOUT",
    "TIMEOUT"
  ].includes(String(abortSignal?.reason?.code ?? ""));
  const cancelled = Boolean(
    (abortSignal?.aborted && !abortedForTimeout) ||
    value?.name === "AbortError" ||
    [
      "ABORT_ERR",
      "CANCELLED",
      "CANCELLED_BY_USER"
    ].includes(code)
  );
  let type =
    TOOL_ERROR_TYPES
      .EXECUTION_FAILED;

  if (cancelled) {
    type = TOOL_ERROR_TYPES.CANCELLED;
  } else if (
    abortedForTimeout ||
    [
      "TOOL_TIMEOUT",
      "TIMEOUT"
    ].includes(code)
  ) {
    type = TOOL_ERROR_TYPES.TIMEOUT;
  } else if (
    POLICY_CODES.has(code)
  ) {
    type = TOOL_ERROR_TYPES.POLICY_DENIED;
  } else if (
    PERMISSION_CODES.has(code)
  ) {
    type =
      TOOL_ERROR_TYPES
        .PERMISSION_DENIED;
  } else if (
    NOT_FOUND_CODES.has(code)
  ) {
    type = TOOL_ERROR_TYPES.NOT_FOUND;
  } else if (
    INVALID_CODES.has(code)
  ) {
    type =
      TOOL_ERROR_TYPES
        .INVALID_ARGUMENTS;
  } else if (
    INVALID_OUTPUT_CODES.has(code)
  ) {
    type = TOOL_ERROR_TYPES.INVALID_OUTPUT;
  } else if (
    CONFLICT_CODES.has(code)
  ) {
    type = TOOL_ERROR_TYPES.CONFLICT;
  } else if (
    RATE_LIMIT_CODES.has(code)
  ) {
    type = TOOL_ERROR_TYPES.RATE_LIMITED;
  } else if (
    [
      "RESULT_TOO_LARGE",
      "OUTPUT_LIMIT"
    ].includes(code)
  ) {
    type =
      TOOL_ERROR_TYPES
        .RESULT_TOO_LARGE;
  } else if (
    TEMPORARY_CODES.has(code)
  ) {
    type =
      TOOL_ERROR_TYPES
        .TEMPORARY_FAILURE;
  }

  const inferredRetryable =
    type ===
      TOOL_ERROR_TYPES
        .TEMPORARY_FAILURE;
  const explicitlyRetryable =
    typeof retryable === "boolean"
      ? retryable
      : inferredRetryable;
  const retryableType = ![
    TOOL_ERROR_TYPES.CANCELLED,
    TOOL_ERROR_TYPES.PERMISSION_DENIED,
    TOOL_ERROR_TYPES.INVALID_ARGUMENTS,
    TOOL_ERROR_TYPES.NOT_FOUND,
    TOOL_ERROR_TYPES.RESULT_TOO_LARGE,
    TOOL_ERROR_TYPES.POLICY_DENIED,
    TOOL_ERROR_TYPES.INVALID_OUTPUT,
    TOOL_ERROR_TYPES.CONFLICT,
    TOOL_ERROR_TYPES.TIMEOUT
  ].includes(type);

  return {
    code:
      code ||
      (cancelled
        ? "CANCELLED_BY_USER"
        : "TOOL_EXECUTION_FAILED"),
    type,
    category: {
      [TOOL_ERROR_TYPES.INVALID_ARGUMENTS]: "invalid_input",
      [TOOL_ERROR_TYPES.INVALID_OUTPUT]: "invalid_output",
      [TOOL_ERROR_TYPES.PERMISSION_DENIED]: "permission_denied",
      [TOOL_ERROR_TYPES.POLICY_DENIED]: "policy_denied",
      [TOOL_ERROR_TYPES.NOT_FOUND]: "not_found",
      [TOOL_ERROR_TYPES.CONFLICT]: "conflict",
      [TOOL_ERROR_TYPES.TIMEOUT]: "timeout",
      [TOOL_ERROR_TYPES.RATE_LIMITED]: "rate_limited",
      [TOOL_ERROR_TYPES.TEMPORARY_FAILURE]: "unavailable",
      [TOOL_ERROR_TYPES.CANCELLED]: "cancelled",
      [TOOL_ERROR_TYPES.RESULT_TOO_LARGE]: "invalid_output"
    }[type] ?? "internal",
    message: messageOf(value),
    retryable:
      retryableType && explicitlyRetryable
  };
}

export function shouldRetryToolError(
  classified,
  policy,
  attempt
) {
  if (
    !classified ||
    !policy ||
    [
      TOOL_ERROR_TYPES.CANCELLED,
      TOOL_ERROR_TYPES.PERMISSION_DENIED,
      TOOL_ERROR_TYPES.INVALID_ARGUMENTS,
      TOOL_ERROR_TYPES.NOT_FOUND,
      TOOL_ERROR_TYPES.RESULT_TOO_LARGE,
      TOOL_ERROR_TYPES.POLICY_DENIED,
      TOOL_ERROR_TYPES.INVALID_OUTPUT,
      TOOL_ERROR_TYPES.CONFLICT,
      TOOL_ERROR_TYPES.TIMEOUT
    ].includes(classified.type)
  ) {
    return false;
  }

  if (
    attempt >=
    Math.max(
      1,
      Number(policy.maxAttempts) || 1
    )
  ) {
    return false;
  }

  return Boolean(
    classified.retryable ||
    policy.retryOn?.includes(
      classified.type
    ) ||
    policy.retryOn?.includes(
      classified.code
    )
  );
}
