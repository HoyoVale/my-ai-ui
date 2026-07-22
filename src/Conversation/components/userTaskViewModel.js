import {
  commandPreview
} from "./commandOutputModel.js";

import {
  formatTaskDuration,
  getToolTitle,
  normalizeToolStatus,
  stopReasonLabel
} from "../utils/taskActivity.js";

function compactText(value, limit = 92) {
  const normalized = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function latestVisibleEvent(snapshot) {
  const events = Array.isArray(snapshot?.events)
    ? snapshot.events
    : [];

  return [...events]
    .reverse()
    .find((event) => [
      "commentary",
      "tool",
      "plan",
      "status"
    ].includes(event?.type));
}

function currentDetail(snapshot) {
  const event = latestVisibleEvent(snapshot);

  if (event?.type === "commentary") {
    return compactText(event.content);
  }

  if (event?.type === "tool") {
    const tool = event.tool ?? {};
    const command = commandPreview(tool);
    const status = normalizeToolStatus(tool.status ?? event.status);

    if (command?.displayCommand) {
      return compactText(
        ["running", "queued", "retrying"].includes(status)
          ? `正在运行 ${command.displayCommand}`
          : `已运行 ${command.displayCommand}`
      );
    }

    const change = tool?.result?.changePreview;
    if (change?.diff) {
      const count = Array.isArray(change.paths) && change.paths.length > 0
        ? change.paths.length
        : 1;
      return ["running", "queued", "retrying"].includes(status)
        ? `正在修改 ${count} 个文件`
        : `已修改 ${count} 个文件`;
    }

    return compactText(getToolTitle(tool));
  }

  if (event?.type === "plan") {
    return compactText(event.title || "更新了任务计划");
  }

  const activePlan = snapshot?.planStats?.active;
  if (activePlan?.title) {
    return compactText(activePlan.title);
  }

  return "";
}

export function createUserTaskViewModel(
  snapshot,
  {
    live = false,
    stopping = false
  } = {}
) {
  const durationMs = Math.max(0, Number(snapshot?.durationMs) || 0);
  const interrupted = snapshot?.interrupted === true;
  const failed = snapshot?.failed === true;
  const aborted = snapshot?.aborted === true;
  const running = live || snapshot?.running === true;
  const continuable = interrupted || [
    "agent_segment_limit",
    "plan_incomplete",
    "needs_input"
  ].includes(snapshot?.stopReason);

  if (stopping) {
    return {
      state: "working",
      label: "正在停止",
      detail: "正在保存当前进度",
      canContinue: false
    };
  }

  if (running) {
    return {
      state: "working",
      label: "正在处理",
      detail: currentDetail(snapshot) || "正在准备下一步",
      canContinue: false
    };
  }

  if (continuable) {
    return {
      state: "continuable",
      label: interrupted ? "任务已中断" : "任务可以继续",
      detail: stopReasonLabel(snapshot?.stopReason || "interrupted"),
      canContinue: true
    };
  }

  if (failed) {
    return {
      state: "failed",
      label: "处理遇到问题",
      detail: stopReasonLabel(snapshot?.stopReason),
      canContinue: false
    };
  }

  if (aborted) {
    return {
      state: "cancelled",
      label: "任务已取消",
      detail: "",
      canContinue: false
    };
  }

  return {
    state: "completed",
    label: durationMs > 0
      ? `处理了 ${formatTaskDuration(durationMs)}`
      : "处理完成",
    detail: "",
    canContinue: false
  };
}
