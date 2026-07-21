export const LIVE_STEP_ROLES = Object.freeze({
  NONE: "none",
  COMMENTARY: "commentary",
  FINAL_CANDIDATE: "final_candidate"
});

const TERMINAL_TOOL_STATUSES = new Set([
  "completed",
  "failed",
  "error",
  "cancelled"
]);

export function inferLiveStepRole({ records = [] } = {}) {
  const hasFinishedTool = (Array.isArray(records) ? records : [])
    .some((record) =>
      record &&
      TERMINAL_TOOL_STATUSES.has(String(record.status ?? ""))
    );

  return hasFinishedTool
    ? LIVE_STEP_ROLES.FINAL_CANDIDATE
    : LIVE_STEP_ROLES.COMMENTARY;
}

export function classifyAgentStep(step = {}) {
  const text = String(
    step.text ?? ""
  ).trim();
  const toolCalls = Array.isArray(
    step.toolCalls
  )
    ? step.toolCalls
    : [];
  const hasToolCalls =
    toolCalls.length > 0 ||
    step.finishReason === "tool-calls";

  if (!text) {
    return {
      kind: "empty",
      text: "",
      objective: inferStepObjective(toolCalls)
    };
  }

  return {
    kind: hasToolCalls
      ? "commentary"
      : "final",
    text,
    objective: inferStepObjective(toolCalls),
    phase: hasToolCalls
      ? "before_tools"
      : "after_tools"
  };
}

export function inferStepObjective(
  toolCalls = []
) {
  const names = Array.isArray(toolCalls)
    ? toolCalls
        .map((call) =>
          String(
            call?.toolName ?? ""
          ).trim()
        )
        .filter(Boolean)
    : [];

  return names.length > 0
    ? names.join("、")
    : "继续处理当前任务";
}
