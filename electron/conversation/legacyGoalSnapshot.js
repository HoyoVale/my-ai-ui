const MAX_DEPTH = 10;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 160;
const MAX_STRING_LENGTH = 200000;

const STATUS_VALUES = new Set([
  "active",
  "paused",
  "completed"
]);

const PHASE_VALUES = new Set([
  "idle",
  "planning",
  "executing",
  "waiting",
  "evaluating",
  "replanning",
  "completed"
]);

function text(value, maxLength = MAX_STRING_LENGTH) {
  return typeof value === "string"
    ? value.slice(0, maxLength)
    : "";
}

function timestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.round(numeric)
    : 0;
}

function sanitizeLegacyValue(value, depth = 0) {
  if (depth > MAX_DEPTH || value == null) return value == null ? null : undefined;

  if (typeof value === "string") {
    return value.slice(0, MAX_STRING_LENGTH);
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeLegacyValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value !== "object") return undefined;

  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    const sanitized = sanitizeLegacyValue(item, depth + 1);
    if (sanitized !== undefined) output[key.slice(0, 160)] = sanitized;
  }
  return output;
}

/**
 * Sanitizes a historical Goal as inert display data.
 *
 * This module intentionally contains no Goal lifecycle, mutation, planning,
 * verification or recovery behavior. The returned snapshot is only retained
 * under Conversation metadata for old-session inspection.
 */
export function sanitizeLegacyGoalSnapshot(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const snapshot = sanitizeLegacyValue(source);
  const id = text(snapshot?.id, 120).trim();
  const objective = text(snapshot?.objective, 4000).trim();

  if (!id && !objective) return null;

  if (id) snapshot.id = id;
  if (objective) snapshot.objective = objective;

  snapshot.version = Math.max(1, Math.min(100, Math.round(Number(snapshot.version) || 1)));
  snapshot.status = STATUS_VALUES.has(snapshot.status)
    ? snapshot.status
    : "active";
  snapshot.phase = PHASE_VALUES.has(snapshot.phase)
    ? snapshot.phase
    : snapshot.status === "completed"
      ? "completed"
      : snapshot.status === "paused"
        ? "waiting"
        : "idle";
  snapshot.createdAt = timestamp(snapshot.createdAt);
  snapshot.updatedAt = timestamp(snapshot.updatedAt || snapshot.createdAt);

  if (!Array.isArray(snapshot.criteria)) snapshot.criteria = [];
  snapshot.criteria = snapshot.criteria.slice(0, 24);

  return snapshot;
}
