const LANGUAGE_RULES = {
  auto:
    "默认使用用户当前使用的语言回答；只有用户明确要求时才切换语言。",
  "zh-CN":
    "默认使用简体中文回答；必要的代码、命令和专有名词可保留原文。",
  "en-US":
    "默认使用自然、清晰的英语回答。"
};

const TONE_RULES = {
  natural:
    "语气自然、平和、不过度热情，也不过分正式。",
  friendly:
    "语气友好、有温度，但避免夸张、撒娇或频繁感叹。",
  professional:
    "语气专业、克制、结构清楚，优先使用准确措辞。",
  direct:
    "语气直接、简练，先给结论，再补充必要说明。"
};

const LENGTH_RULES = {
  concise:
    "优先给出精简答案，只保留完成任务所需的信息。",
  balanced:
    "根据问题复杂度控制篇幅，兼顾结论、解释与可执行步骤。",
  detailed:
    "在不重复的前提下提供更完整的背景、推理说明和操作步骤。"
};

function normalizedText(
  value,
  fallback = ""
) {
  return typeof value === "string"
    ? value.trim()
    : fallback;
}

export function buildPersonalityContext(
  personality = {}
) {
  if (!personality.enabled) {
    return "";
  }

  const name =
    normalizedText(
      personality.name,
      "Xixi"
    ) || "Xixi";

  const identity =
    normalizedText(
      personality.identity,
      "桌面 AI 助手"
    ) || "桌面 AI 助手";

  const languageRule =
    LANGUAGE_RULES[
      personality.language
    ] ?? LANGUAGE_RULES.auto;

  const toneRule =
    TONE_RULES[
      personality.tone
    ] ?? TONE_RULES.natural;

  const lengthRule =
    LENGTH_RULES[
      personality.responseLength
    ] ?? LENGTH_RULES.balanced;

  const customInstructions =
    normalizedText(
      personality.customInstructions
    );

  return [
    "以下是用户为助手明确配置的人格与回复偏好，应当稳定遵循：",
    `- 名称：${name}`,
    `- 身份：${identity}`,
    `- 语言：${languageRule}`,
    `- 语气：${toneRule}`,
    `- 篇幅：${lengthRule}`,
    customInstructions
      ? `- 补充说明：${customInstructions}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function getPersonalitySummary(
  personality = {}
) {
  return {
    enabled:
      Boolean(
        personality.enabled
      ),
    name:
      normalizedText(
        personality.name,
        "Xixi"
      ) || "Xixi",
    identity:
      normalizedText(
        personality.identity,
        "桌面 AI 助手"
      ) || "桌面 AI 助手",
    language:
      personality.language ??
      "auto",
    tone:
      personality.tone ??
      "natural",
    responseLength:
      personality.responseLength ??
      "balanced"
  };
}
