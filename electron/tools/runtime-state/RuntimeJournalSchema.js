import crypto from "node:crypto";

import {
  runtimeChecksum,
  withoutRuntimeIntegrity
} from "./runtimeIntegrity.js";

export const RUNTIME_JOURNAL_SCHEMA_VERSION = 2;

const CRITICAL_EVENT_PREFIXES = [
  "RUN_",
  "SEGMENT_",
  "TOOL_",
  "CHECKPOINT_"
];

function string(value) {
  return String(value ?? "");
}

function integer(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.round(numeric))
    : fallback;
}

export function runtimeEventDurability(type) {
  const name = string(type).toUpperCase();
  return CRITICAL_EVENT_PREFIXES.some((prefix) => name.startsWith(prefix))
    ? "critical"
    : "normal";
}

export function verifyRuntimeJournalEvent(event) {
  if (!event || typeof event !== "object") {
    return false;
  }

  const checksum = string(event.integrity?.checksum ?? event.checksum);
  if (!checksum) {
    return Number(event.version) < RUNTIME_JOURNAL_SCHEMA_VERSION;
  }

  return runtimeChecksum(withoutRuntimeIntegrity(event)) === checksum;
}

export function migrateRuntimeJournalEvent(source) {
  if (!source || typeof source !== "object" || !source.type) {
    return null;
  }

  if (Number(source.version) >= RUNTIME_JOURNAL_SCHEMA_VERSION) {
    if (!verifyRuntimeJournalEvent(source)) {
      return null;
    }

    return {
      ...structuredClone(source),
      version: RUNTIME_JOURNAL_SCHEMA_VERSION,
      eventId: string(source.eventId) || crypto.randomUUID(),
      sequence: integer(source.sequence),
      timestamp: integer(source.timestamp),
      taskId: string(source.taskId),
      runId: string(source.runId),
      workspaceId: string(source.workspaceId),
      segmentId: string(source.segmentId),
      stepId: string(source.stepId),
      callId: string(source.callId),
      type: string(source.type),
      actor: string(source.actor) || "runtime",
      reason: string(source.reason),
      durability: source.durability === "normal" ? "normal" : "critical",
      payload:
        source.payload && typeof source.payload === "object"
          ? structuredClone(source.payload)
          : {}
    };
  }

  const migrated = {
    version: RUNTIME_JOURNAL_SCHEMA_VERSION,
    eventId: string(source.eventId) || crypto.randomUUID(),
    sequence: integer(source.sequence),
    timestamp: integer(source.timestamp),
    taskId: string(source.taskId),
    runId: string(source.runId),
    workspaceId: string(source.workspaceId),
    segmentId: string(source.segmentId),
    stepId: string(source.stepId),
    callId: string(source.callId),
    type: string(source.type),
    actor: string(source.actor) || "runtime",
    reason: string(source.reason),
    durability: source.durability === "normal"
      ? "normal"
      : runtimeEventDurability(source.type),
    payload:
      source.payload && typeof source.payload === "object"
        ? structuredClone(source.payload)
        : {}
  };

  migrated.integrity = {
    algorithm: "sha256",
    checksum: runtimeChecksum(migrated)
  };

  return migrated;
}

export function createRuntimeJournalEvent({
  sequence,
  timestamp = Date.now(),
  taskId = "",
  runId = "",
  workspaceId = "",
  segmentId = "",
  stepId = "",
  callId = "",
  type = "runtime_event",
  actor = "runtime",
  reason = "",
  durability,
  payload = {}
} = {}) {
  const event = {
    version: RUNTIME_JOURNAL_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    sequence: integer(sequence),
    timestamp: integer(timestamp, Date.now()),
    taskId: string(taskId),
    runId: string(runId),
    workspaceId: string(workspaceId),
    segmentId: string(segmentId),
    stepId: string(stepId),
    callId: string(callId),
    type: string(type),
    actor: string(actor) || "runtime",
    reason: string(reason),
    durability: durability === "normal"
      ? "normal"
      : runtimeEventDurability(type),
    payload: structuredClone(payload)
  };

  event.integrity = {
    algorithm: "sha256",
    checksum: runtimeChecksum(event)
  };

  return event;
}
