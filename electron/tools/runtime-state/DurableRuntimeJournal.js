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

async function atomicJsonWrite(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.promises.open(temporary, "wx");
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.promises.rename(temporary, filePath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) {
      await fs.promises.rm(temporary, { force: true });
      throw error;
    }
    await fs.promises.rm(filePath, { force: true });
    await fs.promises.rename(temporary, filePath);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function archivePattern(storageFile) {
  const extension = path.extname(storageFile) || ".jsonl";
  const stem = storageFile.slice(0, -extension.length);
  return {
    extension,
    stem,
    expression: new RegExp(
      `^${escapeRegExp(path.basename(stem))}\\.(\\d{6})${escapeRegExp(extension)}$`,
      "u"
    )
  };
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

export class DurableRuntimeJournal {
  constructor({
    storageFile = "",
    taskId = "",
    runId = "",
    workspaceId = "",
    durable = true,
    redact = null,
    maxFileBytes = 8_000_000,
    maxArchiveFiles = 6,
    maxTotalBytes = 48_000_000,
    manifestFile = ""
  } = {}) {
    this.storageFile = String(storageFile ?? "").trim();
    this.taskId = String(taskId ?? "");
    this.runId = String(runId ?? "");
    this.workspaceId = String(workspaceId ?? "");
    this.durable = durable !== false;
    this.redact = typeof redact === "function"
      ? redact
      : redactSensitiveValue;
    this.maxFileBytes = Math.max(64_000, Number(maxFileBytes) || 8_000_000);
    this.maxArchiveFiles = Math.max(1, Number(maxArchiveFiles) || 6);
    this.maxTotalBytes = Math.max(
      this.maxFileBytes,
      Number(maxTotalBytes) || 48_000_000
    );
    this.manifestFile = String(manifestFile ?? "").trim() || (
      this.storageFile
        ? path.join(path.dirname(this.storageFile), "runtime-journal.manifest.json")
        : ""
    );
    this.events = [];
    this.sequence = 0;
    this.writeChain = Promise.resolve();
    this.closed = false;
    this.rotationCount = 0;
    this.loadReport = {
      loaded: 0,
      migrated: 0,
      skipped: 0,
      files: 0
    };
    this.manifest = this.loadManifest();
    this.load();
  }

  loadManifest() {
    if (!this.manifestFile || !fs.existsSync(this.manifestFile)) {
      return {
        version: 1,
        nextArchive: 1,
        archives: []
      };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.manifestFile, "utf8"));
      return {
        version: 1,
        nextArchive: Math.max(1, positiveInteger(parsed.nextArchive, 1)),
        archives: Array.isArray(parsed.archives)
          ? parsed.archives.map(String).filter(Boolean)
          : []
      };
    } catch {
      return {
        version: 1,
        nextArchive: 1,
        archives: []
      };
    }
  }

  discoverArchives() {
    if (!this.storageFile) {
      return [];
    }
    const directory = path.dirname(this.storageFile);
    if (!fs.existsSync(directory)) {
      return [];
    }
    const pattern = archivePattern(this.storageFile);
    return fs.readdirSync(directory)
      .map((name) => {
        const match = pattern.expression.exec(name);
        return match
          ? {
              name,
              index: Number(match[1]),
              filePath: path.join(directory, name)
            }
          : null;
      })
      .filter(Boolean)
      .sort((left, right) => left.index - right.index);
  }

  filesForLoad() {
    const discovered = this.discoverArchives();
    if (discovered.length > 0) {
      this.manifest.archives = discovered.map((item) => item.name);
      this.manifest.nextArchive = Math.max(
        this.manifest.nextArchive,
        discovered.at(-1).index + 1
      );
    }
    return [
      ...discovered.map((item) => item.filePath),
      ...(this.storageFile && fs.existsSync(this.storageFile)
        ? [this.storageFile]
        : [])
    ];
  }

  load() {
    const seen = new Set();
    for (const filePath of this.filesForLoad()) {
      this.loadReport.files += 1;
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
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
          const identity = String(event.eventId || `${event.sequence}:${event.type}`);
          if (seen.has(identity)) {
            continue;
          }
          seen.add(identity);
          if (Number(source.version) < Number(event.version)) {
            this.loadReport.migrated += 1;
          }
          const normalized = Object.freeze(event);
          this.events.push(normalized);
          this.sequence = Math.max(this.sequence, positiveInteger(event.sequence));
          this.loadReport.loaded += 1;
        } catch {
          this.loadReport.skipped += 1;
        }
      }
    }

    this.events.sort((left, right) =>
      left.sequence - right.sequence || left.timestamp - right.timestamp
    );

    if (this.loadReport.skipped > 0) {
      console.warn(
        `恢复 Tool Runtime Journal 时忽略了 ${this.loadReport.skipped} 条损坏记录。`
      );
    }
  }

  archiveFile(index) {
    const pattern = archivePattern(this.storageFile);
    return `${pattern.stem}.${String(index).padStart(6, "0")}${pattern.extension}`;
  }

  async persistManifest() {
    if (!this.manifestFile) {
      return;
    }
    await atomicJsonWrite(this.manifestFile, {
      version: 1,
      storageFile: path.basename(this.storageFile),
      nextArchive: this.manifest.nextArchive,
      archives: [...this.manifest.archives],
      maxFileBytes: this.maxFileBytes,
      maxArchiveFiles: this.maxArchiveFiles,
      maxTotalBytes: this.maxTotalBytes,
      updatedAt: Date.now()
    });
  }

  async enforceQuota() {
    const directory = path.dirname(this.storageFile);
    const archives = this.discoverArchives();
    let totalBytes = archives.reduce(
      (sum, item) => sum + (safeStat(item.filePath)?.size ?? 0),
      safeStat(this.storageFile)?.size ?? 0
    );
    const retained = [...archives];

    while (
      retained.length > this.maxArchiveFiles ||
      (retained.length > 0 && totalBytes > this.maxTotalBytes)
    ) {
      const oldest = retained.shift();
      const size = safeStat(oldest.filePath)?.size ?? 0;
      await fs.promises.rm(oldest.filePath, { force: true });
      totalBytes = Math.max(0, totalBytes - size);
    }

    this.manifest.archives = retained.map((item) => path.basename(item.filePath));
    if (fs.existsSync(directory)) {
      await this.persistManifest();
    }
  }

  async rotateIfNeeded(nextLineBytes) {
    if (!this.storageFile || !fs.existsSync(this.storageFile)) {
      return false;
    }
    const currentBytes = safeStat(this.storageFile)?.size ?? 0;
    if (currentBytes === 0 || currentBytes + nextLineBytes <= this.maxFileBytes) {
      return false;
    }

    const index = this.manifest.nextArchive;
    this.manifest.nextArchive += 1;
    const archive = this.archiveFile(index);
    await fs.promises.rename(this.storageFile, archive);
    this.manifest.archives.push(path.basename(archive));
    this.rotationCount += 1;
    await this.enforceQuota();
    return true;
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
    const lineBytes = Buffer.byteLength(line, "utf8");
    const write = async () => {
      await this.rotateIfNeeded(lineBytes);
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

  storageSnapshot() {
    const archives = this.discoverArchives();
    return {
      currentBytes: safeStat(this.storageFile)?.size ?? 0,
      archiveCount: archives.length,
      archiveBytes: archives.reduce(
        (sum, item) => sum + (safeStat(item.filePath)?.size ?? 0),
        0
      ),
      rotations: this.rotationCount,
      maxFileBytes: this.maxFileBytes,
      maxArchiveFiles: this.maxArchiveFiles,
      maxTotalBytes: this.maxTotalBytes
    };
  }

  flush() {
    return this.writeChain;
  }

  async close() {
    await this.flush();
    await this.enforceQuota();
    this.closed = true;
    return true;
  }
}
