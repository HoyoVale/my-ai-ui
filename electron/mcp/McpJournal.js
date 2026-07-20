const LEVEL_WEIGHT = Object.freeze({
  user: 1,
  developer: 2,
  debug: 3
});

const MAX_LINES = 160;
const MAX_LINE_LENGTH = 2000;

function safeClone(value) {
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

export function redactMcpLogChunk(chunk, secretValues = []) {
  let text = String(chunk ?? "");
  for (const secret of secretValues) {
    if (String(secret).length >= 4) {
      text = text.split(String(secret)).join("[REDACTED]");
    }
  }
  return text
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/giu, "$1[REDACTED]")
    .replace(/((?:token|api[_-]?key|secret|password)\s*[:=]\s*)[^\s]+/giu, "$1[REDACTED]");
}

export class McpJournal {
  constructor({ maxLines = MAX_LINES } = {}) {
    this.maxLines = maxLines;
    this.entries = new Map();
  }

  append(serverId, message, {
    level = "developer",
    event = "MCP_LOG",
    data = null,
    secretValues = []
  } = {}) {
    const id = String(serverId ?? "global");
    const rows = this.entries.get(id) ?? [];
    const redacted = redactMcpLogChunk(message, secretValues);
    for (const line of redacted.split(/\r?\n/u)) {
      const text = line.trim();
      if (!text) continue;
      rows.push({
        at: Date.now(),
        level: LEVEL_WEIGHT[level] ? level : "developer",
        event,
        text: text.slice(0, MAX_LINE_LENGTH),
        data: data === null ? null : safeClone(data)
      });
    }
    if (rows.length > this.maxLines) {
      rows.splice(0, rows.length - this.maxLines);
    }
    this.entries.set(id, rows);
  }

  list(serverId, { level = "debug" } = {}) {
    const ceiling = LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.debug;
    return (this.entries.get(String(serverId ?? "global")) ?? [])
      .filter((entry) => (LEVEL_WEIGHT[entry.level] ?? 2) <= ceiling)
      .map((entry) => safeClone(entry));
  }

  clear(serverId) {
    this.entries.delete(String(serverId ?? "global"));
  }
}
