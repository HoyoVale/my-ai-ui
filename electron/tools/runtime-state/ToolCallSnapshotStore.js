import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { redactSensitiveValue } from "../core/redaction.js";

function clone(value) {
  return structuredClone(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

async function atomicWrite(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.promises.open(temporary, "wx");
  try {
    await handle.writeFile(JSON.stringify(value), "utf8");
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

export class ToolCallSnapshotStore {
  constructor({ directory = "", taskId = "", workspaceId = "" } = {}) {
    this.directory = String(directory ?? "").trim();
    this.taskId = String(taskId ?? "");
    this.workspaceId = String(workspaceId ?? "");
  }

  snapshotPath(callId) {
    return this.directory && callId
      ? path.join(this.directory, "call-state", `${digest(callId)}.json`)
      : "";
  }

  isOwned(snapshot) {
    return (
      (!this.taskId || snapshot?.taskId === this.taskId) &&
      (!this.workspaceId || snapshot?.workspaceId === this.workspaceId)
    );
  }

  async store(call, { journalSequence = 0 } = {}) {
    const callId = String(call?.callId ?? "").trim();
    if (!callId) {
      return null;
    }
    const retainsInput = [
      "planned",
      "prepared",
      "dispatched",
      "effect_confirmed",
      "cancel_requested",
      "unknown",
      "needs_reconciliation",
      "needs_confirmation"
    ].includes(String(call.state ?? ""));
    const snapshot = {
      version: 1,
      taskId: this.taskId,
      workspaceId: this.workspaceId,
      callId,
      state: String(call.state ?? ""),
      toolId: String(call.toolId ?? ""),
      toolName: String(call.toolName ?? ""),
      runId: String(call.runId ?? ""),
      segmentId: String(call.segmentId ?? ""),
      idempotencyKey: String(call.idempotencyKey ?? ""),
      contract: call.contract && typeof call.contract === "object"
        ? clone(call.contract)
        : null,
      input: !retainsInput || call.input === undefined
        ? null
        : clone(redactSensitiveValue(call.input)),
      attempt: Math.max(0, Number(call.attempt) || 0),
      receiptId: String(call.receiptId ?? ""),
      journalSequence: Math.max(0, Number(journalSequence) || 0),
      latestEvent: call.latestEvent && typeof call.latestEvent === "object"
        ? clone(call.latestEvent)
        : null,
      updatedAt: Date.now()
    };
    const filePath = this.snapshotPath(callId);
    if (filePath) {
      await atomicWrite(filePath, snapshot);
    }
    return clone(snapshot);
  }

  list() {
    const directory = this.directory
      ? path.join(this.directory, "call-state")
      : "";
    if (!directory || !fs.existsSync(directory)) {
      return [];
    }

    return fs.readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          const snapshot = JSON.parse(
            fs.readFileSync(path.join(directory, name), "utf8")
          );
          return snapshot?.callId && this.isOwned(snapshot)
            ? snapshot
            : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .map(clone);
  }
}
