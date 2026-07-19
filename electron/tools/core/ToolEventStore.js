import fs from "node:fs";
import path from "node:path";

import {
  AsyncPersistenceQueue
} from "../../persistence/AsyncPersistenceQueue.js";

import {
  redactSensitiveValue
} from "./redaction.js";

function clone(value) {
  return structuredClone(value);
}

async function appendText(filePath, content) {
  await fs.promises.mkdir(
    path.dirname(filePath),
    {
      recursive: true
    }
  );
  await fs.promises.appendFile(
    filePath,
    content,
    "utf8"
  );
}

export class ToolEventStore {
  constructor({
    storageFile = "",
    redact = null,
    writeDelayMs = 50
  } = {}) {
    this.events = [];
    this.sequence = 0;
    this.storageFile = String(storageFile ?? "").trim();
    this.redact =
      typeof redact === "function"
        ? redact
        : redactSensitiveValue;
    this.pendingLines = [];
    this.writeQueue = this.storageFile
      ? new AsyncPersistenceQueue({
          delayMs: writeDelayMs,
          write: () => this.flushPendingLines(),
          onError: (error) => {
            console.warn("无法持久化工具事件日志：", error);
          }
        })
      : null;
    this.load();
  }

  load() {
    if (!this.storageFile || !fs.existsSync(this.storageFile)) {
      return;
    }

    let skipped = 0;

    try {
      const lines = fs
        .readFileSync(this.storageFile, "utf8")
        .split("\n");

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const event = JSON.parse(line);

          if (!event || typeof event !== "object") {
            skipped += 1;
            continue;
          }

          this.events.push(
            Object.freeze(event)
          );
          this.sequence = Math.max(
            this.sequence,
            Number(event.sequence) || 0
          );
        } catch {
          /*
           * JSONL 最后一行可能在应用异常退出时只写入了一部分。
           * 跳过单条损坏记录，保留其余已经落盘的工具生命周期。
           */
          skipped += 1;
        }
      }
    } catch (error) {
      console.warn("无法恢复工具事件日志：", error);
      return;
    }

    if (skipped > 0) {
      console.warn(
        `恢复工具事件日志时忽略了 ${skipped} 条损坏记录。`
      );
    }
  }

  persist(event) {
    if (!this.writeQueue) {
      return;
    }

    this.pendingLines.push(
      `${JSON.stringify(event)}\n`
    );
    this.writeQueue.enqueue(true);
  }

  async flushPendingLines() {
    if (!this.storageFile || this.pendingLines.length === 0) {
      return;
    }

    const lines = this.pendingLines;
    const content = lines.join("");
    this.pendingLines = [];

    try {
      await appendText(this.storageFile, content);
    } catch (error) {
      this.pendingLines = [
        ...lines,
        ...this.pendingLines
      ];
      throw error;
    }
  }

  flush() {
    return this.writeQueue?.flush() ?? Promise.resolve();
  }

  close() {
    return this.writeQueue?.close() ?? Promise.resolve();
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
