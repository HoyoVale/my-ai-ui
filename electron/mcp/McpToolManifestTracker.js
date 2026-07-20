import crypto from "node:crypto";

function manifestHash(tools = []) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(
      [...tools]
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    ))
    .digest("hex");
}

export class McpToolManifestTracker {
  constructor({ journal = null } = {}) {
    this.journal = journal;
    this.records = new Map();
  }

  update(serverId, tools = []) {
    const id = String(serverId ?? "");
    const hash = manifestHash(tools);
    const previous = this.records.get(id);
    if (previous?.hash === hash) {
      return { ...previous, changed: false };
    }
    const record = {
      hash,
      revision: (previous?.revision ?? 0) + 1,
      changedAt: Date.now(),
      toolCount: tools.length,
      changed: true
    };
    this.records.set(id, record);
    this.journal?.append(id, `Tool manifest changed to revision ${record.revision}.`, {
      level: "developer",
      event: "MCP_TOOLSET_CHANGED",
      data: { revision: record.revision, toolCount: tools.length }
    });
    return record;
  }

  get(serverId) {
    return this.records.get(String(serverId ?? "")) ?? {
      hash: "",
      revision: 0,
      changedAt: null,
      toolCount: 0,
      changed: false
    };
  }

  forget(serverId) {
    this.records.delete(String(serverId ?? ""));
  }
}
