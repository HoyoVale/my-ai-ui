function normalizedText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export const OTHER_OPTION_ID = "__other__";

const OTHER_LABELS = new Set([
  "other",
  "other answer",
  "custom",
  "custom answer",
  "其他",
  "其它",
  "其他回答",
  "其它回答"
]);

export function isOtherOption(option) {
  const id = normalizedText(
    option?.id
  );
  const label = normalizedText(
    option?.label
  );

  return (
    id === OTHER_OPTION_ID ||
    OTHER_LABELS.has(label)
  );
}

export function normalizeAskUserRequest(
  request = {}
) {
  const seen = new Set();
  const options = (
    Array.isArray(request.options)
      ? request.options
      : []
  ).flatMap((option, index) => {
    if (
      !option ||
      typeof option !== "object" ||
      isOtherOption(option)
    ) {
      return [];
    }

    const label = String(
      option.label ?? ""
    ).trim();

    if (!label) {
      return [];
    }

    let id = String(
      option.id ??
      `option-${index + 1}`
    ).trim() || `option-${index + 1}`;

    if (id === OTHER_OPTION_ID) {
      return [];
    }

    if (seen.has(id)) {
      id = `${id}-${index + 1}`;
    }

    seen.add(id);

    return [{
      id: id.slice(0, 80),
      label: label.slice(0, 200)
    }];
  }).slice(0, 6);
  const allowOther =
    request.allowOther !== false;

  return {
    ...request,
    options,
    selectionMode:
      request.selectionMode ===
      "multiple"
        ? "multiple"
        : "single",
    allowOther
  };
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
