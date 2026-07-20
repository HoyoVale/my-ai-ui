import fs from "node:fs";
import path from "node:path";

import { redactSensitiveValue } from "../core/redaction.js";

import {
  createRuntimeJournalEvent,
  migrateRuntimeJournalEvent
} from "./RuntimeJournalSchema.js";

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
    this.loadReport = {
      loaded: 0,
      migrated: 0,
      skipped: 0
    };
    this.load();
  }

  load() {
    if (!this.storageFile || !fs.existsSync(this.storageFile)) {
      return;
    }

    const lines = fs.readFileSync(this.storageFile, "utf8").split("\n");

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const source = JSON.parse(line);
        const event = migrateRuntimeJournalEvent(source);
        if (!event) {
          this.loadReport.skipped += 1;
          continue;
        }
        if (Number(source.version) < Number(event.version)) {
          this.loadReport.migrated += 1;
        }
        const normalized = Object.freeze(event);
        this.events.push(normalized);
        this.sequence = Math.max(
          this.sequence,
          positiveInteger(event.sequence)
        );
        this.loadReport.loaded += 1;
      } catch {
        this.loadReport.skipped += 1;
      }
    }

    if (this.loadReport.skipped > 0) {
      console.warn(
        `恢复 Tool Runtime Journal 时忽略了 ${this.loadReport.skipped} 条损坏记录。`
      );
    }
  }

  append(type, payload = {}, options = {}) {
    if (this.closed) {
      return Promise.reject(new Error("Tool Runtime Journal is closed."));
    }

    const event = Object.freeze(createRuntimeJournalEvent({
      sequence: ++this.sequence,
      timestamp: positiveInteger(options.timestamp, Date.now()),
      taskId: String(options.taskId ?? this.taskId),
      runId: String(options.runId ?? this.runId),
      workspaceId: String(options.workspaceId ?? this.workspaceId),
      segmentId: String(options.segmentId ?? payload.segmentId ?? ""),
      stepId: String(options.stepId ?? payload.stepId ?? ""),
      callId: String(options.callId ?? payload.callId ?? ""),
      type: String(type ?? "runtime_event"),
      actor: String(options.actor ?? "runtime"),
      reason: String(options.reason ?? payload.reason ?? ""),
      durability: options.durability,
      payload: clone(this.redact(payload))
    }));

    this.events.push(event);

    if (!this.storageFile) {
      return Promise.resolve(clone(event));
    }

    const line = `${JSON.stringify(event)}\n`;
    const write = async () => {
      await appendDurably(
        this.storageFile,
        line,
        this.durable && event.durability === "critical"
      );
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

  cursor() {
    const latest = this.events.at(-1) ?? null;
    return {
      sequence: this.sequence,
      checksum: String(latest?.integrity?.checksum ?? ""),
      eventId: String(latest?.eventId ?? "")
    };
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
