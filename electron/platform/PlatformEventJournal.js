import fs from "node:fs";
import path from "node:path";

import {
  canonicalStringify,
  clone,
  sha256
} from "./canonical.js";

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.round(number))
    : fallback;
}

function eventHash(event) {
  const { hash: _hash, ...unsigned } = event;
  return sha256(unsigned);
}

function validateEvent(event, previous = null) {
  if (!event || typeof event !== "object") return false;
  if (positiveInteger(event.sequence) < 1) return false;
  if (!String(event.eventId ?? "") || !String(event.type ?? "")) return false;
  if (event.hash !== eventHash(event)) return false;
  if (previous) {
    if (event.sequence !== previous.sequence + 1) return false;
    if (event.previousHash !== previous.hash) return false;
  } else if (event.previousHash !== "") {
    return false;
  }
  return true;
}

export class PlatformEventJournal {
  constructor({
    getFilePath,
    now = () => Date.now(),
    createId,
    durable = true,
    fileSystem = fs
  } = {}) {
    if (typeof getFilePath !== "function") {
      throw new TypeError("PlatformEventJournal requires getFilePath().");
    }
    if (typeof createId !== "function") {
      throw new TypeError("PlatformEventJournal requires createId().");
    }

    this.getFilePath = getFilePath;
    this.now = now;
    this.createId = createId;
    this.durable = durable !== false;
    this.fileSystem = fileSystem;
    this.events = null;
    this.loadReport = null;
  }

  ensureLoaded() {
    if (this.events) return this.events;

    this.events = [];
    this.loadReport = {
      loaded: 0,
      ignoredTrailingLines: 0,
      integrityFailureAt: null,
      repairedTail: false,
      corruptBackup: null
    };

    let content = "";
    try {
      content = this.fileSystem.readFileSync(this.getFilePath(), "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return this.events;
    }

    const lines = content.split("\n");
    let previous = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        this.loadReport.ignoredTrailingLines = lines
          .slice(index)
          .filter((item) => item.trim()).length;
        break;
      }

      if (!validateEvent(event, previous)) {
        this.loadReport.integrityFailureAt = positiveInteger(event?.sequence, index + 1);
        this.loadReport.ignoredTrailingLines = lines
          .slice(index)
          .filter((item) => item.trim()).length;
        break;
      }

      const frozen = Object.freeze(event);
      this.events.push(frozen);
      previous = frozen;
      this.loadReport.loaded += 1;
    }

    if (
      this.loadReport.integrityFailureAt !== null ||
      this.loadReport.ignoredTrailingLines > 0
    ) {
      this.repairInvalidTail(content);
    }

    return this.events;
  }

  repairInvalidTail(originalContent) {
    const filePath = this.getFilePath();
    const backup = `${filePath}.corrupt.${Date.now()}`;
    const temporary = `${filePath}.${process.pid}.${Date.now()}.repair`;
    const validContent = this.events
      .map((event) => canonicalStringify(event))
      .join("\n");

    this.fileSystem.copyFileSync(filePath, backup);
    const descriptor = this.fileSystem.openSync(temporary, "wx", 0o600);
    try {
      this.fileSystem.writeFileSync(
        descriptor,
        validContent ? `${validContent}\n` : "",
        "utf8"
      );
      if (this.durable) this.fileSystem.fsyncSync(descriptor);
    } finally {
      this.fileSystem.closeSync(descriptor);
    }
    this.fileSystem.rmSync(filePath, { force: true });
    this.fileSystem.renameSync(temporary, filePath);
    this.loadReport.repairedTail = true;
    this.loadReport.corruptBackup = backup;
    this.loadReport.originalBytes = Buffer.byteLength(originalContent, "utf8");
  }

  list({ afterSequence = 0 } = {}) {
    return this.ensureLoaded()
      .filter((event) => event.sequence > positiveInteger(afterSequence))
      .map(clone);
  }

  cursor() {
    const latest = this.ensureLoaded().at(-1);
    return {
      sequence: latest?.sequence ?? 0,
      hash: latest?.hash ?? ""
    };
  }

  append(type, payload = {}) {
    const events = this.ensureLoaded();
    const previous = events.at(-1) ?? null;
    const event = {
      version: 1,
      eventId: this.createId(),
      sequence: (previous?.sequence ?? 0) + 1,
      timestamp: this.now(),
      type: String(type ?? "").trim(),
      payload: clone(payload),
      previousHash: previous?.hash ?? ""
    };
    event.hash = eventHash(event);

    if (!event.type) {
      throw new TypeError("Platform journal event type is required.");
    }

    const filePath = this.getFilePath();
    this.fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    const descriptor = this.fileSystem.openSync(filePath, "a", 0o600);
    try {
      this.fileSystem.writeFileSync(
        descriptor,
        `${canonicalStringify(event)}\n`,
        "utf8"
      );
      if (this.durable) {
        this.fileSystem.fsyncSync(descriptor);
      }
    } finally {
      this.fileSystem.closeSync(descriptor);
    }

    const frozen = Object.freeze(event);
    events.push(frozen);
    return clone(frozen);
  }
}
