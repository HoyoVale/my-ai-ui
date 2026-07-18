import fs from "node:fs";
import path from "node:path";

import {
  redactSensitiveValue
} from "./redaction.js";

function clone(value) {
  return structuredClone(value);
}

export class ToolEventStore {
  constructor({ storageFile = "", redact = null } = {}) {
    this.events = [];
    this.sequence = 0;
    this.storageFile = String(storageFile ?? "").trim();
    this.redact =
      typeof redact === "function"
        ? redact
        : redactSensitiveValue;
    this.load();
  }

  load() {
    if (!this.storageFile || !fs.existsSync(this.storageFile)) {
      return;
    }
    try {
      for (const line of fs.readFileSync(this.storageFile, "utf8").split("\n")) {
        if (!line.trim()) {
          continue;
        }
        const event = JSON.parse(line);
        this.events.push(Object.freeze(event));
        this.sequence = Math.max(this.sequence, Number(event.sequence) || 0);
      }
    } catch (error) {
      console.warn("无法恢复工具事件日志：", error);
    }
  }

  persist(event) {
    if (!this.storageFile) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
      fs.appendFileSync(this.storageFile, `${JSON.stringify(event)}\n`, "utf8");
    } catch (error) {
      console.warn("无法持久化工具事件日志：", error);
    }
  }

  append(event) {
    const stored = Object.freeze({
      ...clone(this.redact(event)),
      sequence: ++this.sequence,
      timestamp: Number(event?.timestamp) || Date.now()
    });
    this.events.push(stored);
    this.persist(stored);
    return clone(stored);
  }

  list() {
    return this.events.map(clone);
  }

  projectRecords() {
    const records = new Map();
    for (const event of this.events) {
      if (event.type === "tool_lifecycle" && event.callId && event.record) {
        records.set(event.callId, clone(event.record));
      }
    }
    return [...records.values()];
  }
}
