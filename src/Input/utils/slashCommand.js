import {
  normalizeSessionMode
} from "../../shared/sessionNavigation.js";

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
