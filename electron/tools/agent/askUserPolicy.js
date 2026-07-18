function normalizedText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function createDecisionKey(
  request = {}
) {
  const explicit = normalizedText(
    request.decisionId
  );

  if (explicit) {
    return explicit.slice(0, 160);
  }

  const question = normalizedText(
    request.question
  );
  const options = Array.isArray(
    request.options
  )
    ? request.options
        .map((option) =>
          normalizedText(
            option?.label ?? option?.id
          )
        )
        .filter(Boolean)
        .sort()
    : [];

  return [
    question,
    ...options
  ].join("|").slice(0, 320);
}

export function countQuestionEvents(
  activity = null
) {
  return Array.isArray(activity?.events)
    ? activity.events.filter(
        (event) =>
          event?.type === "question"
      ).length
    : 0;
}

export function collectAnsweredQuestions(
  activity = null
) {
  if (!Array.isArray(activity?.events)) {
    return [];
  }

  return activity.events
    .filter(
      (event) =>
        event?.type === "question" &&
        event?.question?.status ===
          "answered"
    )
    .map((event) => ({
      ...structuredClone(
        event.question
      ),
      decisionKey:
        event.question.decisionKey ??
        createDecisionKey(
          event.question
        )
    }));
}
