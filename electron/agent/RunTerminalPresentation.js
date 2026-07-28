import {
  classifyLatestToolFailure
} from "./ToolErrorClassifier.js";

import {
  PROVIDER_ERROR_CATEGORIES
} from "./ProviderErrorClassifier.js";

import {
  normalizeRunStopReason,
  RUN_STOP_REASONS
} from "./runStopReasons.js";

export const RUN_TERMINAL_PRESENTATION_VERSION = 1;

export const RUN_TERMINAL_CODES = Object.freeze({
  COMPLETED: "completed",
  COMPLETED_WITH_FALLBACK: "completed_with_fallback",
  CANCELLED: "cancelled",
  NEEDS_INPUT: "needs_input",
  BLOCKED: "blocked",
  CHECKPOINT_READY: "checkpoint_ready",
  TOOL_CONFIRMATION_REQUIRED: "tool_confirmation_required",
  TOOL_RECONCILIATION_REQUIRED: "tool_reconciliation_required",
  TOOL_STATE_UNKNOWN: "tool_state_unknown",
  PROVIDER_AUTHENTICATION: "provider_authentication",
  PROVIDER_PERMISSION: "provider_permission",
  PROVIDER_QUOTA: "provider_quota",
  PROVIDER_INVALID_REQUEST: "provider_invalid_request",
  PROVIDER_NOT_FOUND: "provider_not_found",
  PROVIDER_CONFLICT: "provider_conflict",
  PROVIDER_RATE_LIMITED: "provider_rate_limited",
  PROVIDER_TIMEOUT: "provider_timeout",
  PROVIDER_NETWORK: "provider_network",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  PROVIDER_INTERNAL: "provider_internal",
  TOOL_PERMISSION: "tool_permission",
  TOOL_INVALID_ARGUMENTS: "tool_invalid_arguments",
  TOOL_TIMEOUT: "tool_timeout",
  TOOL_FAILED: "tool_failed",
  OUTPUT_LIMIT: "output_limit",
  CONTENT_FILTER: "content_filter",
  RUN_TIMEOUT: "run_timeout",
  STEP_LIMIT: "step_limit",
  TOOL_CALL_LIMIT: "tool_call_limit",
  REPEATED_TOOL_CALL: "repeated_tool_call",
  NO_PROGRESS: "no_progress",
  INTERRUPTED: "interrupted",
  FAILED: "failed",
  UNKNOWN: "unknown"
});

function bounded(value, limit = 400) {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function terminal({
  code,
  kind,
  title,
  message = "",
  action = "none",
  outcome,
  stopReason,
  resumable = false
}) {
  return Object.freeze({
    version: RUN_TERMINAL_PRESENTATION_VERSION,
    code,
    kind,
    title: bounded(title, 80),
    message: bounded(message, 500),
    action,
    outcome: String(outcome ?? ""),
    stopReason: normalizeRunStopReason(stopReason),
    resumable: resumable === true
  });
}

function recoveryTerminal(runtimeRecovery, context) {
  if (Number(runtimeRecovery?.needsConfirmation) > 0) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.TOOL_CONFIRMATION_REQUIRED,
      kind: "attention",
      title: "需要确认工具操作",
      message: "有工具操作需要确认是否已生效。完成确认后可以继续任务。",
      action: "review_recovery",
      resumable: true
    });
  }

  if (Number(runtimeRecovery?.needsReconciliation) > 0) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.TOOL_RECONCILIATION_REQUIRED,
      kind: "attention",
      title: "需要核验工具操作",
      message: "有工具操作的最终状态尚未核验。完成核验后可以继续任务。",
      action: "review_recovery",
      resumable: true
    });
  }

  if (Number(runtimeRecovery?.unresolvedCount) > 0) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.TOOL_STATE_UNKNOWN,
      kind: "attention",
      title: "工具状态尚未确认",
      message: "有工具操作处于未知状态。请先处理恢复记录，再继续任务。",
      action: "review_recovery",
      resumable: true
    });
  }

  return null;
}

function providerTerminal(classification, context) {
  const category = classification?.category;
  const definitions = {
    [PROVIDER_ERROR_CATEGORIES.AUTHENTICATION]: [
      RUN_TERMINAL_CODES.PROVIDER_AUTHENTICATION,
      "模型配置需要检查",
      "API Key 无效或尚未配置，请在 Setting → Model 中检查。",
      "open_model_settings"
    ],
    [PROVIDER_ERROR_CATEGORIES.PERMISSION]: [
      RUN_TERMINAL_CODES.PROVIDER_PERMISSION,
      "模型访问被拒绝",
      "模型服务拒绝了当前请求，请检查账户和模型访问权限。",
      "open_model_settings"
    ],
    [PROVIDER_ERROR_CATEGORIES.QUOTA]: [
      RUN_TERMINAL_CODES.PROVIDER_QUOTA,
      "模型配额不足",
      "模型账户余额或配额不足，补充配额后可以重试。",
      "retry"
    ],
    [PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST]: [
      RUN_TERMINAL_CODES.PROVIDER_INVALID_REQUEST,
      "模型请求不被接受",
      "模型请求参数或上下文不被服务接受，请检查模型配置或缩短输入。",
      "edit_request"
    ],
    [PROVIDER_ERROR_CATEGORIES.NOT_FOUND]: [
      RUN_TERMINAL_CODES.PROVIDER_NOT_FOUND,
      "找不到模型服务",
      "找不到配置的模型或接口，请检查模型 ID 和 Base URL。",
      "open_model_settings"
    ],
    [PROVIDER_ERROR_CATEGORIES.CONFLICT]: [
      RUN_TERMINAL_CODES.PROVIDER_CONFLICT,
      "模型请求发生冲突",
      "模型服务未接受当前请求，请稍后重试。",
      "retry"
    ],
    [PROVIDER_ERROR_CATEGORIES.RATE_LIMITED]: [
      RUN_TERMINAL_CODES.PROVIDER_RATE_LIMITED,
      "模型请求过于频繁",
      "模型服务仍在限流，请稍后重试。",
      "retry"
    ],
    [PROVIDER_ERROR_CATEGORIES.TIMEOUT]: [
      RUN_TERMINAL_CODES.PROVIDER_TIMEOUT,
      "模型请求超时",
      "模型服务未在限定时间内完成请求，请稍后重试或调整超时时间。",
      "retry"
    ],
    [PROVIDER_ERROR_CATEGORIES.NETWORK]: [
      RUN_TERMINAL_CODES.PROVIDER_NETWORK,
      "无法连接模型服务",
      "请检查网络、代理和 Base URL 后重试。",
      "retry"
    ],
    [PROVIDER_ERROR_CATEGORIES.UNAVAILABLE]: [
      RUN_TERMINAL_CODES.PROVIDER_UNAVAILABLE,
      "模型服务暂时不可用",
      "模型服务暂时不可用，请稍后重试。",
      "retry"
    ]
  };
  const definition = definitions[category];
  if (!definition) return null;
  return terminal({
    ...context,
    code: definition[0],
    kind: "failure",
    title: definition[1],
    message: definition[2],
    action: definition[3]
  });
}

function toolTerminal(records, context) {
  const failure = classifyLatestToolFailure(records);
  if (!failure.found) return null;

  if (["PERMISSION_DENIED", "POLICY_DENIED", "APPROVAL_REQUIRED"].includes(failure.code)) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.TOOL_PERMISSION,
      kind: "failure",
      title: "工具操作被阻止",
      message: "当前工具操作没有获得所需权限。调整授权或任务范围后可以重试。",
      action: "review_permissions"
    });
  }

  if (["INVALID_TOOL_ARGUMENTS", "INVALID_ARGUMENTS"].includes(failure.code)) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.TOOL_INVALID_ARGUMENTS,
      kind: "failure",
      title: "工具参数无效",
      message: "工具没有接受当前参数，任务未能完成。可以调整任务说明后重试。",
      action: "edit_request"
    });
  }

  if (["TOOL_TIMEOUT", "TIMEOUT"].includes(failure.code)) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.TOOL_TIMEOUT,
      kind: "failure",
      title: "工具运行超时",
      message: "工具没有在限定时间内完成。确认操作状态后再重试。",
      action: "retry"
    });
  }

  return terminal({
    ...context,
    code: RUN_TERMINAL_CODES.TOOL_FAILED,
    kind: failure.recoverable ? "attention" : "failure",
    title: failure.toolName
      ? `工具执行失败 · ${bounded(failure.toolName, 40)}`
      : "工具执行失败",
    message: failure.recoverable
      ? "当前进度已保留。修正工具问题后可以继续。"
      : "工具执行失败，当前任务未完成。",
    action: failure.recoverable ? "continue" : "retry",
    resumable: failure.recoverable || context.resumable
  });
}

function boundaryTerminal(reason, context) {
  const definitions = {
    [RUN_STOP_REASONS.AGENT_RUN_TIMEOUT]: [
      RUN_TERMINAL_CODES.RUN_TIMEOUT,
      "本次运行达到时间上限",
      "当前进度已保存，可以继续任务。"
    ],
    [RUN_STOP_REASONS.AGENT_STEP_LIMIT]: [
      RUN_TERMINAL_CODES.STEP_LIMIT,
      "本次运行达到步骤上限",
      "当前进度已保存，可以继续任务。"
    ],
    [RUN_STOP_REASONS.TOOL_CALL_LIMIT]: [
      RUN_TERMINAL_CODES.TOOL_CALL_LIMIT,
      "本次运行达到工具调用上限",
      "当前进度已保存，可以继续任务。"
    ],
    [RUN_STOP_REASONS.REPEATED_TOOL_CALL]: [
      RUN_TERMINAL_CODES.REPEATED_TOOL_CALL,
      "已停止重复工具调用",
      "当前执行出现重复调用，进度已经保存。调整任务说明后可以继续。"
    ],
    [RUN_STOP_REASONS.NO_PROGRESS]: [
      RUN_TERMINAL_CODES.NO_PROGRESS,
      "当前执行没有继续推进",
      "进度已经保存。调整任务说明或环境后可以继续。"
    ],
    [RUN_STOP_REASONS.MODEL_RECOVERY]: [
      RUN_TERMINAL_CODES.CHECKPOINT_READY,
      "模型连接中断，进度已保存",
      "可以从当前检查点继续任务。"
    ]
  };
  const definition = definitions[reason];
  if (!definition) return null;
  return terminal({
    ...context,
    code: definition[0],
    kind: "continuable",
    title: definition[1],
    message: definition[2],
    action: "continue",
    resumable: true
  });
}

export function resolveRunTerminalPresentation({
  outcome = "",
  stopReason = RUN_STOP_REASONS.UNKNOWN,
  resumable = false,
  records = [],
  runtimeRecovery = null,
  providerClassification = null,
  finalizationFailure = null
} = {}) {
  const reason = normalizeRunStopReason(stopReason);
  const context = { outcome, stopReason: reason, resumable };

  const recovery = recoveryTerminal(runtimeRecovery, context);
  if (recovery) return recovery;

  if (outcome === "completed") {
    if (finalizationFailure) {
      return terminal({
        ...context,
        code: RUN_TERMINAL_CODES.COMPLETED_WITH_FALLBACK,
        kind: "completed",
        title: "处理完成",
        message: "任务已完成；最终说明由本地结果整理生成。",
        action: "none"
      });
    }
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.COMPLETED,
      kind: "completed",
      title: "处理完成",
      action: "none"
    });
  }

  if (outcome === "cancelled" || reason === RUN_STOP_REASONS.CANCELLED_BY_USER) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.CANCELLED,
      kind: "cancelled",
      title: "任务已取消",
      message: "本次任务已取消。",
      action: "none"
    });
  }

  if (outcome === "needs_input" || reason === RUN_STOP_REASONS.NEEDS_INPUT) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.NEEDS_INPUT,
      kind: "attention",
      title: "需要补充信息",
      message: "补充所需信息后，可以继续处理。",
      action: "provide_input"
    });
  }

  if (outcome === "blocked" || reason === RUN_STOP_REASONS.BLOCKED) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.BLOCKED,
      kind: "attention",
      title: "任务被阻塞",
      message: "解决当前阻塞条件后可以重试。",
      action: "retry"
    });
  }

  const boundary = boundaryTerminal(reason, context);
  if (boundary) return boundary;

  const provider = providerTerminal(providerClassification, context);
  if (provider) return provider;

  const tool = toolTerminal(records, context);
  if (tool) return tool;

  if (reason === RUN_STOP_REASONS.OUTPUT_LIMIT) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.OUTPUT_LIMIT,
      kind: "attention",
      title: "回复达到输出上限",
      message: "当前结果可能不完整，可以缩小任务范围后重试。",
      action: "edit_request"
    });
  }

  if (reason === RUN_STOP_REASONS.CONTENT_FILTER) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.CONTENT_FILTER,
      kind: "failure",
      title: "内容被安全策略拦截",
      message: "当前请求或回复未能通过模型服务的安全策略。",
      action: "edit_request"
    });
  }

  if (outcome === "interrupted" || reason === RUN_STOP_REASONS.INTERRUPTED) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.INTERRUPTED,
      kind: "continuable",
      title: "任务已中断",
      message: "当前进度已保存，可以继续任务。",
      action: "continue",
      resumable: true
    });
  }

  if (outcome === "continuable" || resumable) {
    return terminal({
      ...context,
      code: RUN_TERMINAL_CODES.CHECKPOINT_READY,
      kind: "continuable",
      title: "当前进度已保存",
      message: "可以从当前检查点继续任务。",
      action: "continue",
      resumable: true
    });
  }

  return terminal({
    ...context,
    code: providerClassification
      ? RUN_TERMINAL_CODES.PROVIDER_INTERNAL
      : outcome === "failed"
        ? RUN_TERMINAL_CODES.FAILED
        : RUN_TERMINAL_CODES.UNKNOWN,
    kind: "failure",
    title: "处理遇到问题",
    message: "当前任务未能完成。请查看任务活动或开发者诊断后重试。",
    action: "retry"
  });
}

export function composeTerminalResponse(content, presentation) {
  const base = String(content ?? "").trim();
  const message = String(presentation?.message ?? "").trim();

  if (!message || presentation?.code === RUN_TERMINAL_CODES.COMPLETED) {
    return base;
  }

  if (base.includes(message)) {
    return base;
  }

  if (!base || /^⚠\s*/u.test(base)) {
    return message;
  }

  if (presentation?.kind === "completed") {
    return base;
  }

  return `${base}\n\n${message}`;
}

export function sanitizeRunTerminalPresentation(value) {
  if (!value || typeof value !== "object") return null;
  const code = bounded(value.code, 80);
  const kind = [
    "completed",
    "continuable",
    "attention",
    "cancelled",
    "failure"
  ].includes(value.kind) ? value.kind : "failure";
  if (!code) return null;
  return {
    version: RUN_TERMINAL_PRESENTATION_VERSION,
    code,
    kind,
    title: bounded(value.title, 80),
    message: bounded(value.message, 500),
    action: bounded(value.action || "none", 80),
    outcome: bounded(value.outcome, 60),
    stopReason: normalizeRunStopReason(value.stopReason),
    resumable: value.resumable === true
  };
}
