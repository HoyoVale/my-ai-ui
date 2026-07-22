import crypto from "node:crypto";

import {
  EXECUTION_ITEM_KINDS,
  sanitizeExecutionItem
} from "./ExecutionItemSchema.js";

const KIND_ORDER = Object.freeze({
  [EXECUTION_ITEM_KINDS.USER_MESSAGE]: 10,
  [EXECUTION_ITEM_KINDS.PLAN_UPDATE]: 20,
  [EXECUTION_ITEM_KINDS.ASSISTANT_COMMENTARY]: 30,
  [EXECUTION_ITEM_KINDS.APPROVAL]: 40,
  [EXECUTION_ITEM_KINDS.TOOL_CALL]: 50,
  [EXECUTION_ITEM_KINDS.COMMAND]: 51,
  [EXECUTION_ITEM_KINDS.FILE_CHANGE]: 52,
  [EXECUTION_ITEM_KINDS.VERIFICATION]: 60,
  [EXECUTION_ITEM_KINDS.CHECKPOINT]: 70,
  [EXECUTION_ITEM_KINDS.DIFF]: 80,
  [EXECUTION_ITEM_KINDS.ERROR]: 90,
  [EXECUTION_ITEM_KINDS.STATUS]: 91,
  [EXECUTION_ITEM_KINDS.ASSISTANT_FINAL]: 100
});

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.round(number))
    : fallback;
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

function projectionMeta(source = {}) {
  const projection = source.projection && typeof source.projection === "object"
    ? source.projection
    : {};

  return {
    timestamp: integer(
      projection.timestamp,
      integer(source.createdAt)
    ),
    group: integer(projection.group, 2),
    sourceSequence: integer(projection.sourceSequence),
    priority: integer(projection.priority),
    dedupeKey: text(projection.dedupeKey, 1000),
    tieBreaker: text(
      projection.tieBreaker || source.sourceId || source.id,
      1000
    )
  };
}

function itemRichness(item, meta) {
  return (
    meta.priority * 1_000_000 +
    (item.resultRef ? 100_000 : 0) +
    (item.parentItemId ? 10_000 : 0) +
    Math.min(9_000, item.summary.length) +
    (item.completedAt != null ? 500 : 0)
  );
}

export function executionItemDedupeKey(source) {
  const item = sanitizeExecutionItem(source);
  if (!item) return "";
  const meta = projectionMeta(source);
  if (meta.dedupeKey) return meta.dedupeKey;
  return [
    item.scope,
    item.threadId,
    item.runId,
    item.kind,
    item.sourceType,
    item.sourceId || item.id
  ].join(":");
}

export function stableExecutionItemId({
  threadId,
  runId = "",
  scope = "run",
  kind,
  sourceType,
  sourceId
} = {}) {
  const identity = [
    text(scope, 40),
    text(threadId, 160),
    text(runId, 160),
    text(kind, 80),
    text(sourceType, 120),
    text(sourceId, 500)
  ].join("|");

  return `item-${stableHash(identity).slice(0, 32)}`;
}

export function sequenceExecutionItems(sources = [], {
  startAt = 1
} = {}) {
  const byKey = new Map();

  for (const source of Array.isArray(sources) ? sources : []) {
    const item = sanitizeExecutionItem(source);
    if (!item) continue;
    const meta = projectionMeta(source);
    const key = executionItemDedupeKey(source);
    const candidate = {
      item,
      meta,
      richness: itemRichness(item, meta),
      canonical: JSON.stringify(item)
    };
    const existing = byKey.get(key);

    if (
      !existing ||
      candidate.richness > existing.richness ||
      (
        candidate.richness === existing.richness &&
        (
          candidate.meta.tieBreaker.localeCompare(existing.meta.tieBreaker) < 0 ||
          (
            candidate.meta.tieBreaker === existing.meta.tieBreaker &&
            candidate.canonical.localeCompare(existing.canonical) < 0
          )
        )
      )
    ) {
      byKey.set(key, candidate);
    }
  }

  const ordered = [...byKey.values()].sort((left, right) => {
    if (left.meta.group !== right.meta.group) {
      return left.meta.group - right.meta.group;
    }
    if (left.meta.timestamp !== right.meta.timestamp) {
      return left.meta.timestamp - right.meta.timestamp;
    }
    if (left.meta.sourceSequence !== right.meta.sourceSequence) {
      return left.meta.sourceSequence - right.meta.sourceSequence;
    }
    const leftKind = KIND_ORDER[left.item.kind] ?? 999;
    const rightKind = KIND_ORDER[right.item.kind] ?? 999;
    if (leftKind !== rightKind) return leftKind - rightKind;
    const tie = left.meta.tieBreaker.localeCompare(right.meta.tieBreaker);
    if (tie !== 0) return tie;
    return left.item.id.localeCompare(right.item.id);
  });

  const firstSequence = Math.max(1, integer(startAt, 1));
  return ordered.map(({ item }, index) => sanitizeExecutionItem({
    ...item,
    sequence: firstSequence + index
  }));
}

export function validateExecutionItemSequence(items = []) {
  const sanitized = (Array.isArray(items) ? items : [])
    .map(sanitizeExecutionItem)
    .filter(Boolean);
  const errors = [];
  const ids = new Set();

  for (let index = 0; index < sanitized.length; index += 1) {
    const item = sanitized[index];
    if (ids.has(item.id)) errors.push(`duplicate-id:${item.id}`);
    ids.add(item.id);
    if (item.sequence !== index + 1) {
      errors.push(`sequence-gap:${item.id}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function executionItemSequenceFingerprint(items = []) {
  const canonical = (Array.isArray(items) ? items : [])
    .map(sanitizeExecutionItem)
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      sequence: item.sequence,
      kind: item.kind,
      status: item.status,
      visibility: item.visibility,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      parentItemId: item.parentItemId,
      summary: item.summary,
      resultRef: item.resultRef,
      resolved: item.resolved,
      supersededBy: item.supersededBy,
      createdAt: item.createdAt,
      completedAt: item.completedAt
    }));

  return stableHash(JSON.stringify(canonical));
}
