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
  const cancelled = Boolean(
    abortSignal?.aborted ||
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
    [
      "TOOL_TIMEOUT",
      "TIMEOUT"
    ].includes(code)
  ) {
    type = TOOL_ERROR_TYPES.TIMEOUT;
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
      : typeof value?.error?.retryable === "boolean"
        ? value.error.retryable
        : inferredRetryable;
  const retryableType = ![
    TOOL_ERROR_TYPES.CANCELLED,
    TOOL_ERROR_TYPES.PERMISSION_DENIED,
    TOOL_ERROR_TYPES.INVALID_ARGUMENTS,
    TOOL_ERROR_TYPES.NOT_FOUND,
    TOOL_ERROR_TYPES.RESULT_TOO_LARGE,
    TOOL_ERROR_TYPES.TIMEOUT
  ].includes(type);

  return {
    code:
      code ||
      (cancelled
        ? "CANCELLED_BY_USER"
        : "TOOL_EXECUTION_FAILED"),
    type,
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
