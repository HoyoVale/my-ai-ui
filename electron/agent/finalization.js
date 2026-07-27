import {
  sanitizePublicAssistantText
} from "./PublicTextSanitizer.js";

import {
  RUN_STOP_REASONS,
  isGracefulRunBoundary,
  isRecoverableRunFailure
} from "./runStopReasons.js";

function text(value, maxLength = 1200) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeFinalizationText(
  value,
  executionStopReason = ""
) {
  const normalized = sanitizePublicAssistantText(value);

  if (
    !normalized ||
    !isGracefulRunBoundary(executionStopReason)
  ) {
    return normalized;
  }

  return normalized
    .replace(/agent_(?:segment|step|run)_limit|agent_run_timeout/giu, "")
    .replace(/tool_(?:call|emergency)_limit/giu, "")
    .replace(/repeated_tool_call|no_progress|model_recovery/giu, "")
    .replace(/checkpoint_ready/giu, "")
    .replace(/达到(?:了)?(?:最大)?(?:任务)?(?:分段|步骤|工具调用|运行时间)(?:次数)?(?:安全)?上限[，,。.]?/gu, "")
    .replace(/(?:reached|hit)\s+(?:the\s+)?(?:maximum\s+)?(?:segment|step|tool|runtime)\s+limit[,.]?/giu, "")
    .replace(/\bsegments?\b/giu, "stages")
    .replace(/\bcheckpoints?\b/giu, "saved progress")
    .replace(/检查点/gu, "当前进展")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function shouldRunFinalization({
  finalText = "",
  records = [],
  finishReason = "",
  stopReason = ""
} = {}) {
  if (text(finalText)) {
    return false;
  }

  const hasWork = Array.isArray(records) && records.length > 0;
  const toolOnlyStop =
    finishReason === "tool-calls" ||
    [
      RUN_STOP_REASONS.AGENT_STEP_LIMIT,
      RUN_STOP_REASONS.COMPLETED,
      RUN_STOP_REASONS.TOOL_CALL_LIMIT,
      RUN_STOP_REASONS.AGENT_RUN_TIMEOUT,
      RUN_STOP_REASONS.REPEATED_TOOL_CALL,
      RUN_STOP_REASONS.MODEL_RECOVERY,
      RUN_STOP_REASONS.NO_PROGRESS,
      RUN_STOP_REASONS.NEEDS_INPUT,
      RUN_STOP_REASONS.BLOCKED
    ].includes(stopReason);

  return Boolean(toolOnlyStop && hasWork);
}

function summarizeRecords(records = []) {
  if (!Array.isArray(records) || records.length === 0) {
    return "No tool activity was recorded.";
  }

  return records
    .slice(-20)
    .map((record, index) => {
      const title = text(
        record?.title ?? record?.name,
        180
      ) || `Tool ${index + 1}`;
      const status = text(
        record?.status,
        40
      ) || "completed";
      const summary = text(
        record?.result?.summary ??
        record?.output?.summary ??
        "",
        320
      );
      const preview = text(
        record?.result?.preview ??
        record?.output?.data ??
        "",
        700
      );
      const detail = [
        summary,
        preview && preview !== summary
          ? preview
          : ""
      ].filter(Boolean).join(" — ");

      return detail
        ? `- ${title} (${status}): ${detail}`
        : `- ${title} (${status})`;
    })
    .join("\n");
}

export function createFinalizationInstruction({
  records = [],
  executionStopReason = ""
} = {}) {
  const isContinuationBoundary =
    isGracefulRunBoundary(executionStopReason) ||
    isRecoverableRunFailure({
      stopReason: executionStopReason,
      records
    });
  const completionNote = executionStopReason === RUN_STOP_REASONS.NEEDS_INPUT
    ? "The task needs additional user input. Clearly state the exact missing input and stop; do not guess."
    : executionStopReason === RUN_STOP_REASONS.BLOCKED
      ? "The task is blocked. Clearly state the blocker and what would unblock it."
      : "Judge completion only from the user request and verified tool results.";

  return [
    "[Finalization phase]",
    completionNote,
    "Generate the final user-facing answer now.",
    "Do not call tools, create a plan, or ask another question unless the task explicitly requires missing user input.",
    isContinuationBoundary
      ? "This is a natural progress handoff, not an error. Summarize the work completed so far, the important results, what remains, and one concrete recommended next action. End naturally so the user can ask you to continue."
      : "Summarize what was completed, the important results, and any remaining limitations.",
    "Only claim that installation, tests, builds, or the whole task succeeded when the tool summaries contain a matching completed command with a successful exit status.",
    "If a tool failed or verification is missing, state that clearly and do not describe the task as complete.",
    "Do not repeat the activity log verbatim.",
    isContinuationBoundary
      ? "Never mention segments, checkpoints, internal execution counts, budgets, limits, stop reasons, or that the runtime paused."
      : "Do not mention internal runtime limits unless they materially affected the user-visible result.",
    executionStopReason && !isContinuationBoundary
      ? `Execution stop reason before finalization: ${text(executionStopReason, 80)}`
      : "",
    "",
    "Tool result summaries:",
    summarizeRecords(records)
  ].filter((line) => line !== "")
    .join("\n");
}

export function createFallbackFinalSummary({
  records = [],
  executionStopReason = ""
} = {}) {
  const summaries = Array.isArray(records)
    ? records
        .filter((record) => record?.status === "completed")
        .map((record) =>
          text(
            record?.result?.summary ??
            record?.title ??
            record?.name,
            300
          )
        )
        .filter(Boolean)
        .slice(-6)
    : [];
  const lines = ["本次工具执行已经结束。"];

  if (summaries.length > 0) {
    lines.push("主要结果：");
    lines.push(...summaries.map((item) => `- ${item}`));
  }

  const isContinuationBoundary =
    isGracefulRunBoundary(executionStopReason) ||
    isRecoverableRunFailure({
      stopReason: executionStopReason,
      records
    });

  if (
    executionStopReason &&
    executionStopReason !== RUN_STOP_REASONS.COMPLETED &&
    !isContinuationBoundary
  ) {
    lines.push(`任务未完全结束：${executionStopReason}。`);
  }

  if (isContinuationBoundary) {
    lines.push("下一步建议：继续完成尚未结束的工作。");
  }

  return sanitizeFinalizationText(
    lines.join("\n"),
    executionStopReason
  );
}
