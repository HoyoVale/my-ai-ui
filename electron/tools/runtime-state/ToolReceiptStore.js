import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function clone(value) {
  return structuredClone(value);
}

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
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

export class ToolReceiptStore {
  constructor({
    directory = "",
    taskId = "",
    workspaceId = ""
  } = {}) {
    this.directory = String(directory ?? "").trim();
    this.taskId = String(taskId ?? "");
    this.workspaceId = String(workspaceId ?? "");
    this.memory = new Map();
  }

  receiptPath(callId) {
    return this.directory
      ? path.join(this.directory, "receipts", `${digest(callId)}.json`)
      : "";
  }

  idempotencyPath(idempotencyKey) {
    return this.directory && idempotencyKey
      ? path.join(this.directory, "idempotency", `${digest(idempotencyKey)}.json`)
      : "";
  }

  invalidationPath(callId) {
    return this.directory && callId
      ? path.join(this.directory, "invalidations", `${digest(callId)}.json`)
      : "";
  }

  isInvalidated(callId) {
    const filePath = this.invalidationPath(callId);
    return Boolean(filePath && fs.existsSync(filePath));
  }

  isOwned(receipt) {
    return (
      (!this.taskId || receipt?.taskId === this.taskId) &&
      (!this.workspaceId || receipt?.workspaceId === this.workspaceId)
    );
  }

  load(callId) {
    const id = String(callId ?? "");
    if (!id) {
      return null;
    }

    if (this.isInvalidated(id)) {
      this.memory.delete(id);
      return null;
    }

    const cached = this.memory.get(id);
    if (cached) {
      return this.isOwned(cached) ? clone(cached) : null;
    }

    const filePath = this.receiptPath(id);
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed?.callId !== id || !this.isOwned(parsed)) {
        return null;
      }
      this.memory.set(id, parsed);
      return clone(parsed);
    } catch {
      return null;
    }
  }

  loadByIdempotencyKey(idempotencyKey) {
    const filePath = this.idempotencyPath(idempotencyKey);
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      const index = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return this.load(index?.callId);
    } catch {
      return null;
    }
  }

  async store({
    callId,
    receiptId = "",
    idempotencyKey = "",
    runId = "",
    segmentId = "",
    toolId = "",
    toolName = "",
    status = "success",
    output,
    result = null,
    error = null,
    attempt = 1,
    startedAt = 0,
    endedAt = Date.now(),
    metadata = null
  } = {}) {
    const id = String(callId ?? "").trim();
    if (!id) {
      throw new Error("Tool receipt requires callId.");
    }

    const existing = this.load(id);
    if (existing) {
      return existing;
    }

    const receipt = {
      version: 1,
      receiptId: String(receiptId ?? "").trim() || crypto.randomUUID(),
      callId: id,
      idempotencyKey: String(idempotencyKey ?? ""),
      taskId: this.taskId,
      workspaceId: this.workspaceId,
      runId: String(runId ?? ""),
      segmentId: String(segmentId ?? ""),
      toolId: String(toolId ?? ""),
      toolName: String(toolName ?? ""),
      status: String(status ?? "success"),
      output: output === undefined ? null : clone(output),
      result: result === undefined ? null : clone(result),
      error: error === undefined ? null : clone(error),
      attempt: Math.max(0, Number(attempt) || 0),
      startedAt: Math.max(0, Number(startedAt) || 0),
      endedAt: Math.max(0, Number(endedAt) || Date.now()),
      metadata: metadata && typeof metadata === "object"
        ? clone(metadata)
        : null
    };
    receipt.checksum = digest(canonicalJson({
      callId: receipt.callId,
      status: receipt.status,
      output: receipt.output,
      error: receipt.error,
      endedAt: receipt.endedAt
    }));

    const filePath = this.receiptPath(id);
    if (filePath) {
      await atomicWrite(filePath, receipt);
      if (receipt.idempotencyKey) {
        await atomicWrite(
          this.idempotencyPath(receipt.idempotencyKey),
          {
            version: 1,
            idempotencyKey: receipt.idempotencyKey,
            callId: receipt.callId,
            receiptId: receipt.receiptId,
            createdAt: receipt.endedAt
          }
        );
      }
      await fs.promises.rm(this.invalidationPath(id), { force: true });
    }

    this.memory.set(id, receipt);
    return clone(receipt);
  }

  async invalidate(receiptOrCallId, { reason = "verification_failed", evidence = null } = {}) {
    const receipt = typeof receiptOrCallId === "object"
      ? receiptOrCallId
      : this.load(receiptOrCallId);
    const callId = String(receipt?.callId ?? receiptOrCallId ?? "").trim();
    if (!callId) {
      return false;
    }

    const filePath = this.invalidationPath(callId);
    if (filePath) {
      await atomicWrite(filePath, {
        version: 1,
        callId,
        receiptId: String(receipt?.receiptId ?? ""),
        idempotencyKey: String(receipt?.idempotencyKey ?? ""),
        taskId: this.taskId,
        workspaceId: this.workspaceId,
        reason: String(reason ?? "verification_failed"),
        evidence: evidence && typeof evidence === "object"
          ? clone(evidence)
          : null,
        invalidatedAt: Date.now()
      });
    }
    this.memory.delete(callId);
    return true;
  }

  list() {
    const receipts = new Map(this.memory);
    const directory = this.directory
      ? path.join(this.directory, "receipts")
      : "";

    if (directory && fs.existsSync(directory)) {
      for (const name of fs.readdirSync(directory)) {
        if (!name.endsWith(".json")) {
          continue;
        }
        try {
          const parsed = JSON.parse(
            fs.readFileSync(path.join(directory, name), "utf8")
          );
          if (
            parsed?.callId &&
            this.isOwned(parsed) &&
            !this.isInvalidated(parsed.callId)
          ) {
            receipts.set(parsed.callId, parsed);
          }
        } catch {
          // Ignore a single damaged receipt. Journal recovery will surface it.
        }
      }
    }

    return [...receipts.values()].map(clone);
  }
}
