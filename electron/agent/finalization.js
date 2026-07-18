import {
  RUN_STOP_REASONS
} from "./runStopReasons.js";

function text(value, maxLength = 1200) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function getPlanCompletionState(
  plan = []
) {
  const items = Array.isArray(plan)
    ? plan
    : [];
  const unfinished = items.filter(
    (item) =>
      [
        "pending",
        "in_progress"
      ].includes(item?.status)
  );
  const blocked = items.filter(
    (item) =>
      item?.status === "blocked"
  );
  const needsInput = items.filter(
    (item) =>
      item?.status === "needs_input"
  );
  const cancelled = items.filter(
    (item) =>
      item?.status === "cancelled"
  );

  return {
    hasPlan: items.length > 0,
    isComplete:
      items.length > 0 &&
      unfinished.length === 0 &&
      blocked.length === 0 &&
      needsInput.length === 0 &&
      cancelled.length === 0,
    hasUnfinished:
      unfinished.length > 0,
    hasBlocked:
      blocked.length > 0,
    hasNeedsInput:
      needsInput.length > 0,
    hasCancelled:
      cancelled.length > 0,
    items
  };
}

export function shouldRunFinalization({
  pendingQuestion = null,
  finalText = "",
  plan = [],
  records = [],
  finishReason = "",
  stopReason = ""
} = {}) {
  if (pendingQuestion) {
    return false;
  }

  if (text(finalText)) {
    return false;
  }

  const hasWork =
    Array.isArray(records) &&
    records.length > 0;
  const planState =
    getPlanCompletionState(plan);
  const toolOnlyStop =
    finishReason === "tool-calls" ||
    [
      RUN_STOP_REASONS.AGENT_STEP_LIMIT,
      RUN_STOP_REASONS.PLAN_INCOMPLETE,
      RUN_STOP_REASONS.COMPLETED,
      RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT,
      RUN_STOP_REASONS.NO_PROGRESS,
      RUN_STOP_REASONS.NEEDS_INPUT,
      RUN_STOP_REASONS.BLOCKED
    ].includes(stopReason);

  return Boolean(
    toolOnlyStop &&
    (hasWork || planState.hasPlan)
  );
}

function summarizePlan(plan = []) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return "No explicit plan was created.";
  }

  return plan
    .slice(0, 20)
    .map((item, index) => {
      const status = text(
        item?.status,
        40
      ) || "pending";
      const title = text(
        item?.title,
        240
      ) || `Step ${index + 1}`;

      return `${index + 1}. [${status}] ${title}`;
    })
    .join("\n");
}

function summarizeRecords(records = []) {
  if (!Array.isArray(records) || records.length === 0) {
    return "No tool activity was recorded.";
  }

  return records
    .filter((record) =>
      ![
        "report_progress",
        "update_plan"
      ].includes(record?.name)
    )
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
    .join("\n") ||
    "Only internal plan/progress tools were used.";
}

export function createFinalizationInstruction({
  plan = [],
  records = [],
  executionStopReason = "",
  answeredQuestion = null
} = {}) {
  const planState =
    getPlanCompletionState(plan);
  const completionNote = planState.hasNeedsInput
    ? "The task needs additional user input. Clearly state the exact missing input and stop; do not guess."
    : planState.isComplete
      ? "The execution plan is complete."
      : planState.hasUnfinished ||
        planState.hasBlocked ||
        planState.hasCancelled
        ? "The execution plan is not fully complete. Clearly state what remains or is blocked."
        : "No explicit execution plan is active.";
  const answerNote = answeredQuestion?.answer
    ? [
        "The user already answered the clarification checkpoint.",
        `Question: ${text(answeredQuestion.question, 600)}`,
        `Answer: ${text(answeredQuestion.answer, 1200)}`,
        "Do not ask the same question again."
      ].join("\n")
    : "";

  return [
    "[Finalization phase]",
    completionNote,
    "Generate the final user-facing answer now.",
    "Do not call tools, create another plan, or ask another question.",
    "Summarize what was completed, the important results, and any remaining limitations.",
    "Do not repeat the activity log verbatim and do not mention internal runtime limits unless they affected the result.",
    executionStopReason
      ? `Execution stop reason before finalization: ${text(executionStopReason, 80)}`
      : "",
    answerNote,
    "",
    "Plan state:",
    summarizePlan(plan),
    "",
    "Tool result summaries:",
    summarizeRecords(records)
  ].filter((line) => line !== "")
    .join("\n");
}

export function createFallbackFinalSummary({
  plan = [],
  records = [],
  executionStopReason = ""
} = {}) {
  const planState =
    getPlanCompletionState(plan);
  const completed = planState.items.filter(
    (item) =>
      item?.status === "completed"
  );
  const summaries = Array.isArray(records)
    ? records
        .filter((record) =>
          record?.status === "completed" &&
          ![
            "report_progress",
            "update_plan"
          ].includes(record?.name)
        )
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

  const lines = [];

  if (planState.isComplete) {
    lines.push("计划已执行完成。");
  } else if (completed.length > 0) {
    lines.push(
      `已完成 ${completed.length}/${planState.items.length} 个计划步骤。`
    );
  } else {
    lines.push("本次工具执行已经结束。");
  }

  if (summaries.length > 0) {
    lines.push("主要结果：");
    lines.push(
      ...summaries.map((item) =>
        `- ${item}`
      )
    );
  }

  if (
    executionStopReason &&
    executionStopReason !==
      RUN_STOP_REASONS.COMPLETED &&
    !planState.isComplete
  ) {
    lines.push(
      `任务未完全结束：${executionStopReason}。`
    );
  }

  return lines.join("\n");
}
