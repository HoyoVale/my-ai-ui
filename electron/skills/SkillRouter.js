const MAX_ROUTER_MESSAGE = 8000;
const TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}_-]*/gu;
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "please",
  "一个", "这个", "那个", "请", "帮我", "进行", "需要", "可以", "如何"
]);

function tokens(value) {
  return [
    ...new Set(
      String(value ?? "")
        .toLowerCase()
        .slice(0, MAX_ROUTER_MESSAGE)
        .match(TOKEN_PATTERN) ?? []
    )
  ].filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function scoreSkill(message, skill) {
  const normalizedMessage = String(message ?? "").toLowerCase().slice(0, MAX_ROUTER_MESSAGE);
  const messageTokens = new Set(tokens(normalizedMessage));
  const keywordList = (skill.keywords ?? []).map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  const identityTokens = tokens(`${skill.id} ${skill.name}`);
  const descriptionTokens = tokens(skill.description);
  let score = 0;
  const reasons = [];

  for (const keyword of keywordList) {
    if (normalizedMessage.includes(keyword)) {
      score += keyword.includes(" ") ? 8 : 6;
      reasons.push(`关键词：${keyword}`);
    }
  }
  for (const token of identityTokens) {
    if (messageTokens.has(token)) {
      score += 4;
      reasons.push(`名称：${token}`);
    }
  }
  let descriptionMatches = 0;
  for (const token of descriptionTokens) {
    if (messageTokens.has(token)) descriptionMatches += 1;
  }
  score += Math.min(6, descriptionMatches * 1.5);
  if (descriptionMatches > 0) reasons.push(`说明匹配 ${descriptionMatches} 项`);

  return { score, reasons: [...new Set(reasons)].slice(0, 6) };
}

export function routeSkillForMessage({ message, skills = [], mode = "chat", threshold = 6 } = {}) {
  const candidates = (Array.isArray(skills) ? skills : [])
    .filter((skill) =>
      skill?.enabled !== false &&
      skill?.available !== false &&
      Array.isArray(skill?.modes) &&
      skill.modes.includes(mode === "coding" ? "coding" : "chat")
    )
    .map((skill) => ({ skill, ...scoreSkill(message, skill) }))
    .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id, "en"));

  const winner = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;
  const confident = Boolean(
    winner &&
    winner.score >= threshold &&
    (!runnerUp || winner.score >= runnerUp.score + 2 || winner.score >= threshold + 4)
  );

  return {
    source: "router",
    matched: confident,
    skillIds: confident ? [winner.skill.id] : [],
    selected: confident
      ? { id: winner.skill.id, name: winner.skill.name, score: winner.score, reasons: winner.reasons }
      : null,
    candidates: candidates.slice(0, 5).map((candidate) => ({
      id: candidate.skill.id,
      name: candidate.skill.name,
      score: candidate.score,
      reasons: candidate.reasons
    })),
    reason: confident
      ? "已根据 Skill 关键词与任务内容自动选择。"
      : winner
        ? "没有 Skill 达到稳定路由阈值，继续使用默认能力。"
        : "当前模式没有可路由的 Skill。"
  };
}
