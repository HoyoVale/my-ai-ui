export const AGENT_STATUS_PROTOCOL_VERSION = 1;

export function resolveAgentStatusRevision(currentRevision, value) {
  const current = Math.max(0, Number(currentRevision) || 0);
  const hasRevision = Boolean(
    value &&
    typeof value === "object" &&
    Object.hasOwn(value, "revision")
  );
  const revision = Number(value?.revision ?? current);

  if (hasRevision && Number.isFinite(revision) && revision < current) {
    return { accepted: false, revision: current };
  }

  return {
    accepted: true,
    revision: Number.isFinite(revision)
      ? Math.max(current, revision)
      : current
  };
}

const TEXT_FIELDS = Object.freeze([
  "liveStepText",
  "finalText"
]);

function clone(value) {
  return value === undefined
    ? undefined
    : structuredClone(value);
}

function serialized(value) {
  return JSON.stringify(value);
}

function equal(left, right) {
  if (Object.is(left, right)) {
    return true;
  }

  return serialized(left) === serialized(right);
}

function keyedMap(items = []) {
  return new Map(
    (Array.isArray(items) ? items : [])
      .filter((item) => item && typeof item === "object" && item.id)
      .map((item) => [String(item.id), item])
  );
}

export function createKeyedCollectionPatch(previous = [], next = []) {
  const before = keyedMap(previous);
  const after = keyedMap(next);
  const upsert = [];
  const remove = [];

  for (const [id, value] of after) {
    if (!before.has(id) || !equal(before.get(id), value)) {
      upsert.push(clone(value));
    }
  }

  for (const id of before.keys()) {
    if (!after.has(id)) {
      remove.push(id);
    }
  }

  if (upsert.length === 0 && remove.length === 0) {
    return null;
  }

  return { upsert, remove };
}

export function applyKeyedCollectionPatch(previous = [], patch = null) {
  if (!patch) {
    return Array.isArray(previous) ? previous : [];
  }

  const map = keyedMap(previous);
  for (const id of patch.remove ?? []) {
    map.delete(String(id));
  }
  for (const item of patch.upsert ?? []) {
    if (item?.id) {
      map.set(String(item.id), clone(item));
    }
  }

  return [...map.values()].sort((left, right) => {
    const leftOrder = Number(left.sequence ?? left.createdAt ?? 0);
    const rightOrder = Number(right.sequence ?? right.createdAt ?? 0);
    return leftOrder - rightOrder;
  });
}

function createActivityPatch(previous, next) {
  const before = previous && typeof previous === "object"
    ? previous
    : null;
  const after = next && typeof next === "object"
    ? next
    : null;

  if (!before && !after) {
    return null;
  }

  if (!after) {
    return { replace: null };
  }

  if (!before) {
    return { replace: clone(after) };
  }

  const changes = {};
  const keys = new Set([
    ...Object.keys(before),
    ...Object.keys(after)
  ]);
  keys.delete("events");

  for (const key of keys) {
    if (!equal(before[key], after[key])) {
      changes[key] = clone(after[key] ?? null);
    }
  }

  const events = createKeyedCollectionPatch(
    before.events,
    after.events
  );

  if (Object.keys(changes).length === 0 && !events) {
    return null;
  }

  return { changes, events };
}

function applyActivityPatch(previous, patch) {
  if (!patch) {
    return previous ?? null;
  }

  if (Object.hasOwn(patch, "replace")) {
    return clone(patch.replace);
  }

  const next = {
    ...(previous && typeof previous === "object" ? previous : {}),
    ...(patch.changes ?? {})
  };

  if (patch.events) {
    next.events = applyKeyedCollectionPatch(
      previous?.events,
      patch.events
    );
  }

  return next;
}

export function createAgentStatusPatch(
  previousStatus,
  nextStatus,
  {
    revision = 0,
    target = "generic"
  } = {}
) {
  const previous = previousStatus && typeof previousStatus === "object"
    ? previousStatus
    : {};
  const next = nextStatus && typeof nextStatus === "object"
    ? nextStatus
    : {};
  const changes = {};
  const keys = new Set([
    ...Object.keys(previous),
    ...Object.keys(next)
  ]);

  for (const field of TEXT_FIELDS) {
    keys.delete(field);
  }
  keys.delete("assistantText");
  keys.delete("activeToolCalls");
  keys.delete("activity");

  for (const key of keys) {
    if (!equal(previous[key], next[key])) {
      changes[key] = clone(next[key] ?? null);
    }
  }

  const activeToolCalls = createKeyedCollectionPatch(
    previous.activeToolCalls,
    next.activeToolCalls
  );
  const activity = createActivityPatch(
    previous.activity,
    next.activity
  );

  if (
    Object.keys(changes).length === 0 &&
    !activeToolCalls &&
    !activity
  ) {
    return null;
  }

  return {
    version: AGENT_STATUS_PROTOCOL_VERSION,
    revision,
    target,
    runId: String(next.runId ?? ""),
    conversationId: String(next.conversationId ?? ""),
    changes,
    collections: {
      activeToolCalls,
      activity
    }
  };
}

export function applyAgentStatusPatch(status, patch) {
  if (!patch || typeof patch !== "object") {
    return status;
  }

  const previous = status && typeof status === "object"
    ? status
    : {};
  const next = {
    ...previous,
    ...(patch.changes ?? {})
  };

  if (patch.collections?.activeToolCalls) {
    next.activeToolCalls = applyKeyedCollectionPatch(
      previous.activeToolCalls,
      patch.collections.activeToolCalls
    );
  }

  if (patch.collections?.activity) {
    next.activity = applyActivityPatch(
      previous.activity,
      patch.collections.activity
    );
  }

  next.assistantText = String(
    next.finalText || next.liveStepText || ""
  );

  return next;
}

function textEventForField({
  field,
  previous,
  next,
  revision,
  target,
  runId,
  conversationId
}) {
  const before = String(previous ?? "");
  const after = String(next ?? "");

  if (before === after) {
    return null;
  }

  const append = after.startsWith(before);
  return {
    version: AGENT_STATUS_PROTOCOL_VERSION,
    revision,
    target,
    runId: String(runId ?? ""),
    conversationId: String(conversationId ?? ""),
    field,
    operation: append ? "append" : "replace",
    text: append ? after.slice(before.length) : after
  };
}

export function createAgentTextEvents(
  previousStatus,
  nextStatus,
  {
    revision = 0,
    target = "generic"
  } = {}
) {
  const previous = previousStatus && typeof previousStatus === "object"
    ? previousStatus
    : {};
  const next = nextStatus && typeof nextStatus === "object"
    ? nextStatus
    : {};

  return TEXT_FIELDS.map((field) => textEventForField({
    field,
    previous: previous[field],
    next: next[field],
    revision,
    target,
    runId: next.runId,
    conversationId: next.conversationId
  })).filter(Boolean);
}

export function applyAgentTextEvent(status, event) {
  if (!event || typeof event !== "object") {
    return status;
  }

  const field = TEXT_FIELDS.includes(event.field)
    ? event.field
    : null;
  if (!field) {
    return status;
  }

  const previous = status && typeof status === "object"
    ? status
    : {};
  const current = String(previous[field] ?? "");
  const nextText = event.operation === "append"
    ? current + String(event.text ?? "")
    : String(event.text ?? "");
  const next = {
    ...previous,
    [field]: nextText
  };
  next.assistantText = String(
    next.finalText || next.liveStepText || ""
  );
  return next;
}

export function createAgentSnapshotEnvelope(
  status,
  {
    revision = 0,
    target = "generic"
  } = {}
) {
  return {
    version: AGENT_STATUS_PROTOCOL_VERSION,
    revision,
    target,
    status: clone(status ?? {})
  };
}
