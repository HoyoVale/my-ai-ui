function countCharacters(
  text
) {
  const value =
    String(text ?? "");

  let cjk = 0;
  let other = 0;

  for (const character of value) {
    if (
      /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u.test(
        character
      )
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }

  return {
    cjk,
    other,
    total: cjk + other
  };
}

export function estimateTextTokens(
  text
) {
  const characters =
    countCharacters(text);

  if (characters.total === 0) {
    return 0;
  }

  return Math.max(
    1,
    Math.ceil(
      characters.cjk * 0.6 +
      characters.other * 0.3
    )
  );
}

export function estimateMessageTokens(
  messages = []
) {
  return messages.reduce(
    (total, message) => {
      return total +
        4 +
        estimateTextTokens(
          message?.content
        );
    },
    0
  );
}

export function buildTokenBudget({
  sections,
  contextTokenBudget,
  outputReserve
}) {
  const normalizedBudget =
    Math.max(
      1024,
      Math.round(
        Number(
          contextTokenBudget
        ) || 64000
      )
    );

  const normalizedReserve =
    Math.max(
      0,
      Math.min(
        normalizedBudget,
        Math.round(
          Number(outputReserve) ||
          0
        )
      )
    );

  const baseSections =
    sections.map((section) => ({
      ...section,
      tokens:
        Math.max(
          0,
          Math.round(
            Number(section.tokens) ||
            0
          )
        )
    }));

  const inputTokens =
    baseSections.reduce(
      (total, section) =>
        total + section.tokens,
      0
    );

  const totalTokens =
    inputTokens +
    normalizedReserve;

  const normalizedSections =
    baseSections.map(
      (section) => ({
        ...section,
        inputShareRatio:
          inputTokens > 0
            ? section.tokens /
              inputTokens
            : 0,
        budgetShareRatio:
          normalizedBudget > 0
            ? section.tokens /
              normalizedBudget
            : 0
      })
    );

  const inputLimit =
    Math.max(
      0,
      normalizedBudget -
      normalizedReserve
    );

  const remaining =
    Math.max(
      0,
      inputLimit -
      inputTokens
    );

  const availableTokens =
    Math.max(
      0,
      normalizedBudget -
      inputTokens
    );

  const currentInputRatio =
    normalizedBudget > 0
      ? Math.min(
          1,
          inputTokens /
            normalizedBudget
        )
      : 1;

  const worstCaseRatio =
    normalizedBudget > 0
      ? Math.min(
          1,
          totalTokens /
            normalizedBudget
        )
      : 1;

  return {
    estimated: true,
    totalTokens,
    inputTokens,
    outputReserve:
      normalizedReserve,
    contextTokenBudget:
      normalizedBudget,
    inputLimit,
    remaining,
    availableTokens,
    overflowTokens:
      Math.max(
        0,
        inputTokens -
        inputLimit
      ),
    currentInputRatio,
    worstCaseRatio,
    usageRatio: worstCaseRatio,
    inputUsageRatio:
      inputLimit > 0
        ? Math.min(
            1,
            inputTokens /
              inputLimit
          )
        : 1,
    sections:
      normalizedSections
  };
}

function jsonText(value) {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

export function estimateJsonTokens(value) {
  return estimateTextTokens(jsonText(value));
}

export function estimateToolDefinitionTokens(definition = {}) {
  return estimateJsonTokens({
    name: definition.name ?? "",
    description: definition.description ?? "",
    inputSchema: definition.inputSchema ?? definition.schema ?? null
  });
}

export function estimateToolDefinitionsTokens(definitions = []) {
  return (Array.isArray(definitions) ? definitions : []).reduce(
    (total, definition) => total + estimateToolDefinitionTokens(definition),
    0
  );
}

export function normalizeProviderUsage(source = {}) {
  const usage = source && typeof source === "object" ? source : {};
  const inputTokens = Math.max(
    0,
    Number(
      usage.inputTokens ??
      usage.promptTokens ??
      usage.inputTokenCount
    ) || 0
  );
  const outputTokens = Math.max(
    0,
    Number(
      usage.outputTokens ??
      usage.completionTokens ??
      usage.outputTokenCount
    ) || 0
  );
  const reasoningTokens = Math.max(
    0,
    Number(
      usage.reasoningTokens ??
      usage.outputTokenDetails?.reasoningTokens ??
      usage.completionTokensDetails?.reasoningTokens
    ) || 0
  );
  const cachedInputTokens = Math.max(
    0,
    Number(
      usage.cachedInputTokens ??
      usage.inputTokenDetails?.cacheReadTokens ??
      usage.promptTokensDetails?.cachedTokens
    ) || 0
  );
  const totalTokens = Math.max(
    0,
    Number(usage.totalTokens) || inputTokens + outputTokens
  );

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    totalTokens,
    reported: Boolean(
      inputTokens || outputTokens || totalTokens || reasoningTokens || cachedInputTokens
    )
  };
}
