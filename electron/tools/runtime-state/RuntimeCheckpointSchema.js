import {
  runtimeChecksum,
  withoutRuntimeIntegrity
} from "./runtimeIntegrity.js";

export const RUNTIME_CHECKPOINT_SCHEMA_VERSION = 3;

function string(value, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.round(numeric))
    : fallback;
}

function strings(values, maxItems = 200) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => string(value, 160))
      .filter(Boolean)
  )].slice(0, maxItems);
}

export function verifyRuntimeCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") {
    return false;
  }

  const checksum = string(checkpoint.integrity?.checksum, 128);
  if (!checksum) {
    return Number(checkpoint.version) < RUNTIME_CHECKPOINT_SCHEMA_VERSION;
  }

  return runtimeChecksum(withoutRuntimeIntegrity(checkpoint)) === checksum;
}

export function migrateRuntimeCheckpoint(source, { verify = true } = {}) {
  if (!source || typeof source !== "object") {
    return null;
  }

  if (
    verify &&
    Number(source.version) >= RUNTIME_CHECKPOINT_SCHEMA_VERSION &&
    !verifyRuntimeCheckpoint(source)
  ) {
    return null;
  }

  const migrated = {
    ...structuredClone(source),
    version: RUNTIME_CHECKPOINT_SCHEMA_VERSION,
    taskId: string(source.taskId, 120),
    runId: string(source.runId, 120),
    workspaceId: string(source.workspaceId, 120),
    journalSequence: integer(
      source.journalSequence ?? source.recoveryCursor?.journalSequence
    ),
    journalChecksum: string(
      source.journalChecksum ?? source.recoveryCursor?.journalChecksum,
      128
    ),
    committedSegmentId: string(
      source.committedSegmentId ?? source.recoveryCursor?.committedSegmentId,
      120
    ),
    reportedReceiptIds: strings(
      source.reportedReceiptIds ?? source.recoveryCursor?.reportedReceiptIds
    ),
    unresolvedCallIds: strings(
      source.unresolvedCallIds ?? source.recoveryCursor?.unresolvedCallIds
    ),
    snapshotSource: string(source.snapshotSource, 80) || "checkpoint",
    updatedAt: integer(source.updatedAt, Date.now()),
    persistedAt: integer(source.persistedAt)
  };

  delete migrated.recoveryCursor;
  delete migrated.integrity;

  migrated.integrity = {
    algorithm: "sha256",
    checksum: runtimeChecksum(migrated)
  };

  return migrated;
}
