import fs from "node:fs";
import path from "node:path";

import { redactSensitiveValue } from "../core/redaction.js";

function clone(value) {
  return structuredClone(value);
}

function positiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.round(numeric))
    : fallback;
}

async function appendDurably(filePath, line, durable) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.promises.open(filePath, "a");

  try {
    await handle.writeFile(line, "utf8");
    if (durable) {
      await handle.sync();
    }
  } finally {
    await handle.close();
  }
}

export class DurableRuntimeJournal {
  constructor({
    storageFile = "",
    taskId = "",
    runId = "",
    workspaceId = "",
    durable = true,
    redact = null
  } = {}) {
    this.storageFile = String(storageFile ?? "").trim();
    this.taskId = String(taskId ?? "");
    this.runId = String(runId ?? "");
    this.workspaceId = String(workspaceId ?? "");
    this.durable = durable !== false;
    this.redact = typeof redact === "function"
      ? redact
      : redactSensitiveValue;
    this.events = [];
    this.sequence = 0;
    this.writeChain = Promise.resolve();
    this.closed = false;
    this.load();
  }

  load() {
    if (!this.storageFile || !fs.existsSync(this.storageFile)) {
      return;
    }

    let skipped = 0;
    const lines = fs.readFileSync(this.storageFile, "utf8").split("\n");

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const event = JSON.parse(line);
        if (!event || typeof event !== "object" || !event.type) {
          skipped += 1;
          continue;
        }
        const normalized = Object.freeze(event);
        this.events.push(normalized);
        this.sequence = Math.max(
          this.sequence,
          positiveInteger(event.sequence)
        );
      } catch {
        skipped += 1;
      }
    }

    if (skipped > 0) {
      console.warn(
        `恢复 Tool Runtime Journal 时忽略了 ${skipped} 条损坏记录。`
      );
    }
  }

  append(type, payload = {}, options = {}) {
    if (this.closed) {
      return Promise.reject(new Error("Tool Runtime Journal is closed."));
    }

    const event = Object.freeze({
      version: 1,
      sequence: ++this.sequence,
      timestamp: positiveInteger(options.timestamp, Date.now()),
      taskId: String(options.taskId ?? this.taskId),
      runId: String(options.runId ?? this.runId),
      workspaceId: String(options.workspaceId ?? this.workspaceId),
      segmentId: String(options.segmentId ?? payload.segmentId ?? ""),
      callId: String(options.callId ?? payload.callId ?? ""),
      type: String(type ?? "runtime_event"),
      payload: clone(this.redact(payload))
    });

    this.events.push(event);

    if (!this.storageFile) {
      return Promise.resolve(clone(event));
    }

    const line = `${JSON.stringify(event)}\n`;
    const write = async () => {
      await appendDurably(this.storageFile, line, this.durable);
      return clone(event);
    };

    this.writeChain = this.writeChain.then(write, write);
    return this.writeChain;
  }

  list() {
    return this.events.map(clone);
  }

  eventsForCall(callId) {
    const id = String(callId ?? "");
    return this.events
      .filter((event) => event.callId === id)
      .map(clone);
  }

  latestByCall() {
    const calls = new Map();
    for (const event of this.events) {
      if (!event.callId) {
        continue;
      }
      const existing = calls.get(event.callId) ?? {
        callId: event.callId,
        events: []
      };
      existing.events.push(clone(event));
      existing.latest = clone(event);
      calls.set(event.callId, existing);
    }
    return [...calls.values()];
  }

  flush() {
    return this.writeChain;
  }

  async close() {
    await this.flush();
    this.closed = true;
    return true;
  }
}
