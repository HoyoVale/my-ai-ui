const COMMAND_PATTERN = /^\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?=\s|$)/u;
export const MAX_SKILL_COMMANDS = 4;

export function parseSkillCommand(input, availableSkillIds = []) {
  const original = String(input ?? "").trim();
  if (!original.startsWith("/")) {
    return { matched: false, content: original, skillIds: [] };
  }

  const available = new Set(
    (Array.isArray(availableSkillIds) ? availableSkillIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  );
  const skillIds = [];
  let rest = original;
  let commandCount = 0;

  while (true) {
    const match = COMMAND_PATTERN.exec(rest);
    if (!match || !available.has(match[1])) break;
    commandCount += 1;
    if (commandCount > MAX_SKILL_COMMANDS) {
      return {
        matched: true,
        ok: false,
        code: "skill-command-limit",
        message: `一次最多临时组合 ${MAX_SKILL_COMMANDS} 个 Skill。`,
        content: "",
        skillIds
      };
    }
    if (!skillIds.includes(match[1])) skillIds.push(match[1]);
    rest = rest.slice(match[0].length).trimStart();
  }

  if (!skillIds.length) {
    return { matched: false, content: original, skillIds: [] };
  }

  if (!rest.trim()) {
    return {
      matched: true,
      ok: false,
      code: "skill-command-message-required",
      message: `请在 ${skillIds.map((id) => `/${id}`).join(" ")} 后输入任务内容。`,
      content: "",
      skillIds
    };
  }

  return {
    matched: true,
    ok: true,
    source: "command",
    command: skillIds.map((id) => `/${id}`).join(" "),
    content: rest.trim(),
    skillIds
  };
}
