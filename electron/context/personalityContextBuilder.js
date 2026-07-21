const LEGACY_LANGUAGE_RULES = {
  auto: "跟随用户使用的语言",
  "zh-CN": "默认使用简体中文",
  "en-US": "默认使用英语"
};

const LEGACY_TONE_RULES = {
  natural: "语气自然清晰",
  friendly: "语气友好但不过度热情",
  professional: "语气专业、克制、结构清楚",
  direct: "表达直接，先给结论"
};

const LEGACY_LENGTH_RULES = {
  concise: "回答尽量精简",
  balanced: "篇幅根据问题复杂度调整",
  detailed: "在不重复的前提下提供完整细节"
};

function normalizedText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function legacyPreferences(personality) {
  return [
    LEGACY_LANGUAGE_RULES[personality.language] ?? LEGACY_LANGUAGE_RULES.auto,
    LEGACY_TONE_RULES[personality.tone] ?? LEGACY_TONE_RULES.natural,
    LEGACY_LENGTH_RULES[personality.responseLength] ?? LEGACY_LENGTH_RULES.balanced
  ].join("；") + "。";
}

export function buildPersonalityContext(personality = {}) {
  if (!personality.enabled) return "";

  const name = normalizedText(personality.name, "Xixi") || "Xixi";
  const identity = normalizedText(personality.identity, "桌面 AI 助手") || "桌面 AI 助手";
  const preferences = normalizedText(
    personality.responsePreferences,
    legacyPreferences(personality)
  );
  const customInstructions = normalizedText(personality.customInstructions);

  return [
    "以下是用户为助手明确配置的人格与回复偏好，应当稳定遵循：",
    `- 名称：${name}`,
    `- 身份：${identity}`,
    preferences ? `- 回复偏好：${preferences}` : "",
    customInstructions ? `- 补充说明：${customInstructions}` : ""
  ].filter(Boolean).join("\n");
}

export function getPersonalitySummary(personality = {}) {
  return {
    enabled: Boolean(personality.enabled),
    name: normalizedText(personality.name, "Xixi") || "Xixi",
    identity: normalizedText(personality.identity, "桌面 AI 助手") || "桌面 AI 助手",
    responsePreferences: normalizedText(
      personality.responsePreferences,
      legacyPreferences(personality)
    ),
    // Keep legacy fields in metadata for backward-compatible tests and histories.
    language: personality.language ?? "auto",
    tone: personality.tone ?? "natural",
    responseLength: personality.responseLength ?? "balanced"
  };
}
