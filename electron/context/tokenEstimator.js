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

  const normalizedSections =
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
    normalizedSections.reduce(
      (total, section) =>
        total + section.tokens,
      0
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

  return {
    estimated: true,
    totalTokens:
      inputTokens +
      normalizedReserve,
    inputTokens,
    outputReserve:
      normalizedReserve,
    contextTokenBudget:
      normalizedBudget,
    inputLimit,
    remaining,
    overflowTokens:
      Math.max(
        0,
        inputTokens -
        inputLimit
      ),
    usageRatio:
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
