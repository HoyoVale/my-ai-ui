import {
  normalizeSessionMode
} from "../../shared/sessionNavigation.js";

export const BUILTIN_SLASH_COMMANDS = Object.freeze([
  { id: "goal", name: "Goal", description: "设置、暂停或查看当前会话的长期目标", action: { type: "open-context", page: "goal" } },
  { id: "model", name: "模型", description: "切换当前会话使用的模型", action: { type: "open-context", page: "model" } },
  { id: "workspace", name: "工作区", description: "选择或添加当前任务的工作区", action: { type: "open-context", page: "workspace" } },
  { id: "session", name: "会话", description: "切换或新建会话", action: { type: "open-context", page: "session" } },
  { id: "skill", name: "Skills", description: "选择常驻 Skill 或设置自动路由", action: { type: "open-context", page: "skill" } },
  { id: "mcp", name: "MCP", description: "查看并切换当前 MCP 连接", action: { type: "open-context", page: "mcp" } },
  { id: "mode", name: "模式", description: "在 Chat 与 Coding 工作流之间切换", action: { type: "open-context", page: "mode" } },
  { id: "new", name: "新建会话", description: "在当前模式和工作区中新建会话", action: { type: "new-session" } },
  { id: "plan", name: "计划", description: "打开 Conversation 查看当前执行计划", action: { type: "open-window", window: "conversation" } },
  { id: "status", name: "任务状态", description: "打开 Conversation 查看计划、工具与 Goal 进度", action: { type: "open-window", window: "conversation" } },
  { id: "memory", name: "Memory", description: "打开长期记忆管理", action: { type: "open-window", window: "memory" } },
  { id: "settings", name: "Settings", description: "打开应用设置", action: { type: "open-window", window: "settings" } }
]);

export function findSlashCommand(value, cursorPosition) {
  const text = String(value ?? "");
  const cursor = Math.max(0, Math.min(text.length, Number(cursorPosition) || 0));
  const prefix = text.slice(0, cursor);
  const match = prefix.match(/(^|\s)\/([a-zA-Z0-9_-]*)$/u);
  if (!match) return null;

  const slashOffset = match[0].lastIndexOf("/");
  const start = cursor - (match[0].length - slashOffset);
  return {
    start,
    end: cursor,
    query: match[2].toLowerCase()
  };
}

function normalizedModes(skill) {
  return (Array.isArray(skill?.modes) ? skill.modes : [])
    .map((value) => normalizeSessionMode(String(value ?? "").toLowerCase(), ""))
    .filter(Boolean);
}

export function filterSlashSkillSuggestions(
  skills,
  {
    mode = "chat",
    query = "",
    limit = 8
  } = {}
) {
  const normalizedMode = normalizeSessionMode(mode, "chat");
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  const maxItems = Math.max(1, Math.min(Number(limit) || 8, 20));

  return (Array.isArray(skills) ? skills : [])
    .filter((skill) =>
      normalizedModes(skill).includes(normalizedMode) &&
      skill?.enabled !== false &&
      skill?.available !== false &&
      (!skill?.integrity || skill.integrity === "verified")
    )
    .filter((skill) => {
      if (!normalizedQuery) return true;
      return [skill.id, skill.name, ...(skill.keywords ?? [])]
        .some((candidate) =>
          String(candidate ?? "").toLowerCase().includes(normalizedQuery)
        );
    })
    .slice(0, maxItems);
}

export function filterSlashCommandSuggestions({
  commands = BUILTIN_SLASH_COMMANDS,
  skills = [],
  mode = "chat",
  query = "",
  limit = 10
} = {}) {
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  const normalizedMode = normalizeSessionMode(mode, "chat");
  const builtins = (Array.isArray(commands) ? commands : [])
    .filter((command) => !command.modes || command.modes.includes(normalizedMode))
    .filter((command) => !normalizedQuery || [command.id, command.name, command.description]
      .some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery)))
    .map((command) => ({ ...command, kind: "command" }));
  const skillSuggestions = filterSlashSkillSuggestions(skills, {
    mode: normalizedMode,
    query: normalizedQuery,
    limit: 20
  }).map((skill) => ({ ...skill, kind: "skill" }));

  const score = (item) => {
    if (!normalizedQuery) return item.kind === "command" ? 0 : 1;
    const id = String(item.id ?? "").toLowerCase();
    const name = String(item.name ?? "").toLowerCase();
    const description = String(item.description ?? "").toLowerCase();
    if (id === normalizedQuery) return 0;
    if (id.startsWith(normalizedQuery)) return 1;
    if (name.startsWith(normalizedQuery)) return 2;
    if (id.includes(normalizedQuery) || name.includes(normalizedQuery)) return 3;
    return description.includes(normalizedQuery) ? 4 : 5;
  };

  return [...builtins, ...skillSuggestions]
    .sort((left, right) => score(left) - score(right))
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 20)));
}
