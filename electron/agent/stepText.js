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
    objective: inferStepObjective(toolCalls)
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
