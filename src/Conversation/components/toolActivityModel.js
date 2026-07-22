import {
  commandPreview
} from "./commandOutputModel.js";

import {
  describeToolTarget,
  formatTaskDuration,
  getToolTitle,
  normalizeToolStatus,
  toolStatusLabel
} from "../utils/taskActivity.js";

function boundedText(value, limit = 220) {
  const normalized = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

export function toolChangePreview(tool) {
  const source =
    tool?.result?.changePreview ??
    tool?.changePreview ??
    null;

  if (!source || typeof source !== "object" || !source.diff) {
    return null;
  }

  return {
    id: tool?.activityId ?? tool?.id ?? "tool-change",
    paths: Array.isArray(source.paths) && source.paths.length > 0
      ? source.paths
      : source.path
        ? [source.path]
        : [],
    diff: source.diff,
    truncated: source.truncated === true
  };
}

function resultError(tool) {
  return boundedText(
    tool?.result?.error?.message ??
    tool?.lastError?.message ??
    "",
    260
  );
}

function resultSummary(tool) {
  return boundedText(tool?.result?.summary, 260);
}

function presentationTitle({ kind, status, tool }) {
  if (kind === "command") {
    if (["running", "queued", "retrying"].includes(status)) {
      return "正在运行命令";
    }
    if (status === "error") {
      return "命令执行失败";
    }
    if (status === "aborted") {
      return "命令已取消";
    }
    return "已运行命令";
  }

  if (kind === "diff") {
    if (["running", "queued", "retrying"].includes(status)) {
      return "正在修改文件";
    }
    if (status === "error") {
      return "文件修改失败";
    }
    if (status === "aborted") {
      return "文件修改已取消";
    }
    return "已修改文件";
  }

  return getToolTitle(tool);
}

export function createToolActivityView(tool) {
  const command = commandPreview(tool);
  const change = toolChangePreview(tool);
  const status = normalizeToolStatus(
    tool?.status ?? tool?.result?.status
  );
  const kind = command
    ? "command"
    : change
      ? "diff"
      : "tool";
  const error = resultError(tool);
  const summary = error || resultSummary(tool);
  const target = boundedText(describeToolTarget(tool), 160);
  const durationMs = Math.max(0, Number(tool?.durationMs) || 0);
  const statusText = durationMs > 0 && !["running", "queued", "retrying"].includes(status)
    ? formatTaskDuration(durationMs)
    : toolStatusLabel(status);

  return {
    kind,
    status,
    title: presentationTitle({ kind, status, tool }),
    toolTitle: getToolTitle(tool),
    target,
    summary,
    error,
    command,
    change,
    statusText,
    running: ["running", "queued", "retrying"].includes(status),
    failed: status === "error",
    aborted: status === "aborted",
    attention: status === "attention",
    expandable: Boolean(command || change || summary),
    defaultOpen: ["running", "queued", "retrying", "error", "attention"].includes(status)
  };
}
