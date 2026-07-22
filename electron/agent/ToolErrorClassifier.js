const RECOVERABLE_TOOL_CODES = new Set([
  "NOT_FOUND",
  "TEMPORARY_FAILURE",
  "TOOL_TIMEOUT",
  "INVALID_TOOL_ARGUMENTS",
  "INVALID_ARGUMENTS",
  "RESULT_TOO_LARGE",
  "TOOL_RESULT_TOO_LARGE",
  "REPEATED_TOOL_CALL",
  "PLAN_STEP_REQUIRED",
  "PLAN_ROOT_STEP_NOT_FOUND",
  "PLAN_ROOT_STEP_NOT_ACTIVE",
  "PLAN_REPLAN_REQUIRED",
  "PLAN_REPLAN_REASON_REQUIRED",
  "PLAN_REPLAN_ASSUMPTION_REQUIRED",
  "TEXT_NOT_FOUND",
  "SEARCH_PATH_NOT_DIRECTORY",
  "FILE_TOO_LARGE",
  "TOOL_CIRCUIT_OPEN",
  "PACKAGE_SCRIPT_FAILED",
  "PROCESS_EXIT_NON_ZERO"
]);

const FATAL_TOOL_CODES = new Set([
  "CANCELLED_BY_USER",
  "PERMISSION_DENIED",
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
  "TOOL_EFFECT_UNKNOWN",
  "TOOL_CONFIRMATION_REQUIRED",
  "TOOL_RECEIPT_VERIFICATION_FAILED"
]);

const RECOVERABLE_CATEGORIES = new Set([
  "not_found",
  "invalid_input",
  "invalid_output",
  "timeout",
  "unavailable",
  "rate_limited",
  "process_exit"
]);

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function normalizedPath(input = {}) {
  return String(
    input.path ?? input.filePath ?? input.targetPath ?? input.cwd ?? ""
  ).replace(/\\/gu, "/").toLowerCase();
}

export function toolAttemptKey(record = {}) {
  const name = String(record.name ?? record.toolName ?? "").trim();
  const input = record.input && typeof record.input === "object"
    ? record.input
    : {};

  if (name === "run_project_script") {
    return `${name}:${String(input.script ?? input.task ?? "").trim()}:${normalizedPath(input)}`;
  }

  if ([
    "write_text_file",
    "replace_text_in_file",
    "append_text_file",
    "read_text_file",
    "delete_path",
    "move_path",
    "stat_path",
    "inspect_path"
  ].includes(name)) {
    return `${name}:${normalizedPath(input)}`;
  }

  if (["update_plan", "replan_goal", "update_step_work"].includes(name)) {
    return `plan-control:${name}`;
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(stableValue(input)).slice(0, 1200);
  } catch {
    serialized = "";
  }
  return `${name}:${serialized}`;
}

export function toolErrorFromRecord(record = {}) {
  const error = record?.result?.error ?? record?.output?.error ?? null;
  if (!error && !["failed", "error"].includes(String(record?.status ?? ""))) {
    return null;
  }
  const code = String(error?.code ?? "TOOL_ERROR").trim() || "TOOL_ERROR";
  const category = String(error?.category ?? "").trim();
  const recoverable = !FATAL_TOOL_CODES.has(code) && (
    error?.retryable === true ||
    RECOVERABLE_TOOL_CODES.has(code) ||
    RECOVERABLE_CATEGORIES.has(category)
  );
  return {
    code,
    category,
    recoverable,
    fatal: FATAL_TOOL_CODES.has(code),
    message: String(error?.message ?? record?.lastError?.message ?? "").trim(),
    toolName: String(record?.name ?? "").trim()
  };
}

export function classifyToolFailureHistory(records = []) {
  const activeByKey = new Map();
  const resolved = [];
  const ordered = Array.isArray(records) ? records : [];

  for (let index = 0; index < ordered.length; index += 1) {
    const record = ordered[index];
    if (!record || typeof record !== "object") continue;
    const key = toolAttemptKey(record);
    const error = toolErrorFromRecord(record);
    const status = String(record.status ?? "");

    if (error) {
      activeByKey.set(key, {
        ...error,
        key,
        index,
        record
      });
      continue;
    }

    if (status === "completed" && activeByKey.has(key)) {
      const prior = activeByKey.get(key);
      activeByKey.delete(key);
      resolved.push({
        ...prior,
        resolvedByIndex: index,
        resolvedByRecord: record
      });
    }
  }

  const active = [...activeByKey.values()].sort((left, right) => left.index - right.index);
  return {
    active,
    resolved,
    latestActive: active.at(-1) ?? null,
    hasActive: active.length > 0,
    hasFatal: active.some((item) => item.fatal),
    hasRecoverable: active.some((item) => item.recoverable)
  };
}

export function classifyLatestToolFailure(records = []) {
  const history = classifyToolFailureHistory(records);
  const latest = history.latestActive;
  if (!latest) {
    return {
      found: false,
      recoverable: false,
      fatal: false,
      code: "",
      category: "",
      message: "",
      toolName: "",
      resolvedCount: history.resolved.length
    };
  }
  return {
    found: true,
    recoverable: latest.recoverable,
    fatal: latest.fatal,
    code: latest.code,
    category: latest.category,
    message: latest.message,
    toolName: latest.toolName,
    resolvedCount: history.resolved.length
  };
}

export function hasActiveToolFailures(records = []) {
  return classifyToolFailureHistory(records).hasActive;
}
