import {
  recoverInterruptedExecutionThread,
  sanitizeExecutionThread
} from "../agent/ExecutionThread.js";

import {
  createThreadRoutingDecision
} from "./ThreadRoutingDecision.js";

const MAX_THREADS = 48;
const MAX_ROUTING_DECISIONS = 200;

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function sanitizeRoutingDecision(source) {
  if (!source || typeof source !== "object") return null;
  return createThreadRoutingDecision({
    ...source,
    shadowMode: source.shadow?.enabled === true,
    legacyAction: source.shadow?.legacyAction ?? source.legacyAction,
    now: source.createdAt
  });
}

export function sanitizePersistedRoutingDecisions(source) {
  const seen = new Set();
  return (Array.isArray(source) ? source : [])
    .map(sanitizeRoutingDecision)
    .filter((decision) => {
      if (!decision || seen.has(decision.id)) return false;
      seen.add(decision.id);
      return true;
    })
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-MAX_ROUTING_DECISIONS);
}

export function sanitizeExecutionThreadCollection(source = {}) {
  const legacyThread = sanitizeExecutionThread(source.executionThread);
  const candidates = Array.isArray(source.executionThreads)
    ? source.executionThreads
    : legacyThread
      ? [legacyThread]
      : [];
  const byId = new Map();
  for (const candidate of candidates) {
    const thread = sanitizeExecutionThread(candidate);
    if (!thread) continue;
    const current = byId.get(thread.id);
    if (!current || thread.updatedAt >= current.updatedAt) {
      byId.set(thread.id, thread);
    }
  }
  if (legacyThread) {
    const current = byId.get(legacyThread.id);
    if (!current || legacyThread.updatedAt >= current.updatedAt) {
      byId.set(legacyThread.id, legacyThread);
    }
  }

  const executionThreads = [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_THREADS);
  const requestedActiveId = text(
    source.activeExecutionThreadId || legacyThread?.id
  );
  const activeExecutionThreadId = executionThreads.some(
    (thread) => thread.id === requestedActiveId
  )
    ? requestedActiveId
    : executionThreads[0]?.id ?? null;
  const executionThread = executionThreads.find(
    (thread) => thread.id === activeExecutionThreadId
  ) ?? null;

  return {
    activeExecutionThreadId,
    executionThreads,
    executionThread,
    routingDecisions: sanitizePersistedRoutingDecisions(
      source.routingDecisions
    )
  };
}

export function findExecutionThread(conversation, threadId = "") {
  const collection = sanitizeExecutionThreadCollection(conversation);
  const id = text(threadId) || collection.activeExecutionThreadId || "";
  return collection.executionThreads.find((thread) => thread.id === id) ?? null;
}

export function applyExecutionThreadCollection(conversation, {
  thread = null,
  activeThreadId = undefined,
  routingDecisions = undefined
} = {}) {
  const collection = sanitizeExecutionThreadCollection(conversation);
  const byId = new Map(
    collection.executionThreads.map((item) => [item.id, item])
  );
  const normalizedThread = sanitizeExecutionThread(thread);
  if (normalizedThread) byId.set(normalizedThread.id, normalizedThread);

  const executionThreads = [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_THREADS);
  const requestedActiveId = activeThreadId === undefined
    ? normalizedThread?.id || collection.activeExecutionThreadId
    : text(activeThreadId);
  const resolvedActiveId = executionThreads.some(
    (item) => item.id === requestedActiveId
  )
    ? requestedActiveId
    : executionThreads[0]?.id ?? null;

  conversation.executionThreads = executionThreads;
  conversation.activeExecutionThreadId = resolvedActiveId;
  conversation.executionThread = executionThreads.find(
    (item) => item.id === resolvedActiveId
  ) ?? null;
  conversation.routingDecisions = routingDecisions === undefined
    ? collection.routingDecisions
    : sanitizePersistedRoutingDecisions(routingDecisions);
  return conversation.executionThread;
}

export function appendPersistedRoutingDecision(conversation, decision) {
  const normalized = sanitizeRoutingDecision(decision);
  if (!normalized) return null;
  const collection = sanitizeExecutionThreadCollection(conversation);
  const next = collection.routingDecisions.filter(
    (item) => item.id !== normalized.id
  );
  next.push(normalized);
  applyExecutionThreadCollection(conversation, {
    activeThreadId: collection.activeExecutionThreadId,
    routingDecisions: next
  });
  return clone(normalized);
}

export function recoverExecutionThreadCollection(source, {
  now = Date.now()
} = {}) {
  const collection = sanitizeExecutionThreadCollection(source);
  let changed = false;
  const executionThreads = collection.executionThreads.map((thread) => {
    const recovery = recoverInterruptedExecutionThread(thread, { now });
    if (recovery.changed) changed = true;
    return recovery.thread;
  });
  const holder = {
    ...source,
    executionThreads,
    activeExecutionThreadId: collection.activeExecutionThreadId,
    routingDecisions: collection.routingDecisions
  };
  const normalized = sanitizeExecutionThreadCollection(holder);
  return {
    changed,
    ...normalized
  };
}
