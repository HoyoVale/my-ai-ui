import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function hash(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

async function writeAtomic(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(value), "utf8");
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

export class ToolLeaseStore {
  constructor({ directory = "", ownerId = "" } = {}) {
    this.directory = String(directory ?? "").trim();
    this.ownerId = String(ownerId ?? "") || crypto.randomUUID();
  }

  leasePath(callId) {
    return this.directory
      ? path.join(this.directory, "leases", `${hash(callId)}.json`)
      : "";
  }

  read(callId) {
    const filePath = this.leasePath(callId);
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  async acquire({ callId, ttlMs = 60_000, attempt = 1, idempotencyKey = "" }) {
    const now = Date.now();
    const existing = this.read(callId);

    if (
      existing &&
      existing.ownerId !== this.ownerId &&
      Number(existing.expiresAt) > now
    ) {
      return {
        ok: false,
        code: "TOOL_CALL_LEASED",
        lease: existing
      };
    }

    const lease = {
      version: 1,
      callId: String(callId ?? ""),
      ownerId: this.ownerId,
      idempotencyKey: String(idempotencyKey ?? ""),
      attempt: Math.max(1, Number(attempt) || 1),
      acquiredAt: existing?.acquiredAt ?? now,
      heartbeatAt: now,
      expiresAt: now + Math.max(5_000, Number(ttlMs) || 60_000)
    };

    const filePath = this.leasePath(callId);
    if (filePath) {
      await writeAtomic(filePath, lease);
    }

    return { ok: true, lease };
  }

  async heartbeat(callId, ttlMs = 60_000) {
    const lease = this.read(callId);
    if (!lease || lease.ownerId !== this.ownerId) {
      return false;
    }

    const now = Date.now();
    const next = {
      ...lease,
      heartbeatAt: now,
      expiresAt: now + Math.max(5_000, Number(ttlMs) || 60_000)
    };
    const filePath = this.leasePath(callId);
    if (filePath) {
      await writeAtomic(filePath, next);
    }
    return true;
  }

  async release(callId) {
    const filePath = this.leasePath(callId);
    if (!filePath) {
      return true;
    }

    const lease = this.read(callId);
    if (lease && lease.ownerId !== this.ownerId) {
      return false;
    }

    await fs.promises.rm(filePath, { force: true });
    return true;
  }

  list() {
    const directory = this.directory
      ? path.join(this.directory, "leases")
      : "";
    if (!directory || !fs.existsSync(directory)) {
      return [];
    }

    return fs.readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(directory, name), "utf8")
          );
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}
