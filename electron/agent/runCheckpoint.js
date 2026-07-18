function text(value, maxLength = 1200) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function compactPlan(plan = []) {
  return (Array.isArray(plan) ? plan : [])
    .slice(0, 20)
    .map((item, index) => ({
      id:
        text(
          item?.id,
          80
        ) || `step-${index + 1}`,
      title: text(
        item?.title,
        240
      ),
      status: text(
        item?.status,
        40
      ) || "pending",
      reason: text(
        item?.reason,
        300
      )
    }));
}

function compactToolRecords(
  records = [],
  maxRecords = 16
) {
  return (Array.isArray(records) ? records : [])
    .filter((record) =>
      ![
        "report_progress",
        "update_plan"
      ].includes(record?.name)
    )
    .slice(-maxRecords)
    .map((record) => ({
      id: text(record?.id, 120),
      name: text(record?.name, 120),
      title: text(
        record?.title ?? record?.name,
        200
      ),
      status: text(
        record?.status,
        40
      ),
      planStepId: text(
        record?.planStep?.id,
        80
      ),
      summary: text(
        record?.result?.summary ??
        record?.output?.data?.message ??
        record?.output?.error?.message,
        420
      ),
      preview: text(
        record?.result?.preview,
        700
      ),
      reference:
        record?.result?.reference ??
        null,
      error:
        record?.result?.error
          ? {
              code: text(
                record.result.error.code,
                80
              ),
              type: text(
                record.result.error.type,
                80
              ),
              message: text(
                record.result.error.message,
                360
              ),
              retryable:
                record.result.error.retryable ===
                true
            }
          : null,
      attempt:
        Number(record?.attempt) || 0,
      maxAttempts:
        Number(record?.maxAttempts) || 0
    }));
}

function compactAnsweredQuestions(
  questions = []
) {
  return (Array.isArray(questions) ? questions : [])
    .slice(-6)
    .map((question) => ({
      decisionKey: text(
        question?.decisionKey,
        320
      ),
      question: text(
        question?.question,
        600
      ),
      answer: text(
        question?.answer,
        1200
      )
    }))
    .filter((item) => item.question);
}

export function createRunCheckpoint({
  goalId = "",
  taskId = "",
  runId = "",
  messageId = "",
  phase = "executing",
  plan = [],
  records = [],
  answeredQuestions = [],
  pendingQuestion = null,
  stopReason = "",
  contextCompactions = 0,
  orchestration = null,
  updatedAt = Date.now()
} = {}) {
  const compactedPlan =
    compactPlan(plan);
  const tools =
    compactToolRecords(records);
  const questions =
    compactAnsweredQuestions(
      answeredQuestions
    );
  const counts = {
    tools: tools.length,
    completedTools:
      tools.filter(
        (item) =>
          item.status === "completed"
      ).length,
    failedTools:
      tools.filter(
        (item) =>
          item.status === "failed"
      ).length,
    completedPlanSteps:
      compactedPlan.filter(
        (item) =>
          item.status === "completed"
      ).length,
    totalPlanSteps:
      compactedPlan.length
  };

  return {
    version: 1,
    goalId: text(goalId, 120),
    taskId: text(taskId, 120),
    runId: text(runId, 120),
    messageId: text(messageId, 120),
    phase: text(phase, 40),
    stopReason: text(
      stopReason,
      80
    ),
    updatedAt:
      Math.max(
        0,
        Math.round(
          Number(updatedAt) || Date.now()
        )
      ),
    counts: {
      ...counts,
      contextCompactions: Math.max(
        0,
        Number(contextCompactions) || 0
      )
    },
    plan: compactedPlan,
    tools,
    answeredQuestions: questions,
    pendingQuestion:
      pendingQuestion?.question
        ? {
            question: text(
              pendingQuestion.question,
              600
            ),
            decisionKey: text(
              pendingQuestion.decisionKey,
              320
            )
          }
        : null,
    orchestration:
      orchestration && typeof orchestration === "object"
        ? structuredClone(orchestration) : null
  };
}

export function createCheckpointInstruction(
  checkpoint
) {
  if (
    !checkpoint ||
    typeof checkpoint !== "object"
  ) {
    return "";
  }

  const planLines =
    (checkpoint.plan ?? [])
      .map((item, index) =>
        `${index + 1}. [${item.status}] ${item.title}${item.reason ? ` — ${item.reason}` : ""}`
      );
  const toolLines =
    (checkpoint.tools ?? [])
      .map((item) => {
        const detail = [
          item.summary,
          item.reference?.resultId
            ? `result reference: ${item.reference.resultId}`
            : ""
        ].filter(Boolean).join(" — ");

        return detail
          ? `- ${item.title} [${item.status}]: ${detail}`
          : `- ${item.title} [${item.status}]`;
      });
  const answerLines =
    (checkpoint.answeredQuestions ?? [])
      .map((item) =>
        `- ${item.question}: ${item.answer}`
      );

  return [
    "[Persisted run checkpoint]",
    "Continue from this compact checkpoint instead of reconstructing the task from raw historical tool output.",
    checkpoint.phase
      ? `Phase: ${checkpoint.phase}`
      : "",
    checkpoint.orchestration?.segmentCount
      ? `Segments: ${checkpoint.orchestration.segmentCount}/${checkpoint.orchestration.limits?.maxSegments ?? "?"}; no-progress streak: ${checkpoint.orchestration.noProgressSegments ?? 0}`
      : "",
    "Advance unfinished work from this checkpoint. Do not repeat completed tool calls.",
    planLines.length > 0
      ? "Plan:\n" + planLines.join("\n")
      : "",
    toolLines.length > 0
      ? "Recent tool results:\n" + toolLines.join("\n")
      : "",
    answerLines.length > 0
      ? "Answered decisions:\n" + answerLines.join("\n")
      : "",
    checkpoint.pendingQuestion?.question
      ? `Pending question: ${checkpoint.pendingQuestion.question}`
      : ""
  ].filter(Boolean).join("\n\n");
}
