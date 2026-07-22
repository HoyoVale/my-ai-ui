export function clone(value) {
  return structuredClone(value);
}

export function createTitle(content) {
  const normalized = String(content ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "新会话";
  return normalized.length > 28 ? `${normalized.slice(0, 28)}…` : normalized;
}
