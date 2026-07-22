import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  canonicalStringify,
  clone,
  sha256
} from "./canonical.js";

const SIGNATURE_VERSION = 1;

function text(value, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "hex");
  const rightBuffer = Buffer.from(String(right ?? ""), "hex");
  return leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export class CompletionAuthority {
  constructor({
    getKeyPath,
    now = () => Date.now(),
    randomBytes = crypto.randomBytes
  } = {}) {
    if (typeof getKeyPath !== "function") {
      throw new TypeError("CompletionAuthority requires getKeyPath().");
    }

    this.getKeyPath = getKeyPath;
    this.now = now;
    this.randomBytes = randomBytes;
    this.key = null;
  }

  loadKey() {
    if (this.key) {
      return this.key;
    }

    const keyPath = this.getKeyPath();
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });

    try {
      const existing = fs.readFileSync(keyPath);
      if (existing.length >= 32) {
        this.key = existing;
        return this.key;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const temporary = `${keyPath}.${process.pid}.${Date.now()}.tmp`;
    const generated = this.randomBytes(32);
    fs.writeFileSync(temporary, generated, { mode: 0o600, flag: "wx" });
    try {
      fs.renameSync(temporary, keyPath);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") {
        throw error;
      }
    }

    this.key = fs.readFileSync(keyPath);
    return this.key;
  }

  signPayload(payload) {
    return crypto
      .createHmac("sha256", this.loadKey())
      .update(canonicalStringify(payload))
      .digest("hex");
  }

  issue({
    goalId,
    goalRevision,
    platformRunId,
    integrationHash,
    evidenceHash,
    verifierVersion = 1,
    scope = "platform-kernel-v1"
  } = {}) {
    const payload = {
      version: SIGNATURE_VERSION,
      goalId: text(goalId, 120),
      goalRevision: Math.max(1, Math.round(Number(goalRevision) || 1)),
      platformRunId: text(platformRunId, 120),
      integrationHash: text(integrationHash, 128),
      evidenceHash: text(evidenceHash, 128),
      verifierVersion: Math.max(1, Math.round(Number(verifierVersion) || 1)),
      scope: text(scope, 80),
      issuedAt: this.now()
    };

    if (
      !payload.goalId ||
      !payload.platformRunId ||
      !/^[a-f0-9]{64}$/u.test(payload.integrationHash) ||
      !/^[a-f0-9]{64}$/u.test(payload.evidenceHash)
    ) {
      throw new TypeError("Completion signature payload is incomplete.");
    }

    return {
      payload,
      signature: this.signPayload(payload),
      fingerprint: sha256(payload)
    };
  }

  verify(signature, expected = {}) {
    if (!signature?.payload || !signature?.signature) {
      return { ok: false, code: "completion-signature-missing" };
    }

    const payload = signature.payload;
    const expectedSignature = this.signPayload(payload);
    if (!timingSafeEqual(signature.signature, expectedSignature)) {
      return { ok: false, code: "completion-signature-invalid" };
    }

    const checks = {
      goalId: text(expected.goalId, 120),
      platformRunId: text(expected.platformRunId, 120),
      goalRevision: Math.max(1, Math.round(Number(expected.goalRevision) || 1))
    };
    if (
      payload.version !== SIGNATURE_VERSION ||
      payload.goalId !== checks.goalId ||
      payload.platformRunId !== checks.platformRunId ||
      payload.goalRevision !== checks.goalRevision
    ) {
      return { ok: false, code: "completion-signature-stale" };
    }

    return {
      ok: true,
      payload: clone(payload),
      fingerprint: sha256(payload)
    };
  }
}
