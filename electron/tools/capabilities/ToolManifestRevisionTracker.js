export class ToolManifestRevisionTracker {
  constructor() {
    this.entries = new Map();
  }

  observe(key, hash) {
    const normalizedKey = String(key ?? "global") || "global";
    const normalizedHash = String(hash ?? "");
    const current = this.entries.get(normalizedKey);
    if (!current) {
      const entry = { revision: 1, hash: normalizedHash };
      this.entries.set(normalizedKey, entry);
      return { ...entry, changed: true };
    }
    if (current.hash === normalizedHash) {
      return { ...current, changed: false };
    }
    const entry = {
      revision: current.revision + 1,
      hash: normalizedHash
    };
    this.entries.set(normalizedKey, entry);
    return { ...entry, changed: true };
  }

  reset(key = null) {
    if (key === null || key === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(String(key));
  }
}

export const toolManifestRevisionTracker = new ToolManifestRevisionTracker();
