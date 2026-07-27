export const LEGACY_PLAN_SCHEMA_VERSION = 3;

const LEGACY_PLAN_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "needs_input",
  "skipped",
  "cancelled",
  "superseded"
]);

const TERMINAL_LEGACY_PLAN_STATUSES = new Set([
  "completed",
  "blocked",
  "needs_input",
  "skipped",
  "cancelled",
  "superseded"
]);

const MAX_LEGACY_PLAN_ITEMS = 40;
const MAX_LEGACY_SUBPLANS = 24;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value, maxLength) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function timestamp(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0
    ? Math.round(normalized)
    : fallback;
}

function sanitizeLegacyReplan(source) {
  if (!source || typeof source !== "object") return null;
  const reason = text(source.reason, 500);
  if (!reason) return null;
  return {
    reason,
    failedAssumption: text(source.failedAssumption, 500),
    runId: text(source.runId, 120),
    at: timestamp(source.at, 0)
  };
}

export function sanitizeLegacyPlanItems(items, { maxItems = MAX_LEGACY_PLAN_ITEMS } = {}) {
  const normalized = Array.isArray(items)
    ? items
        .map((item, index) => ({
          id: text(item?.id ?? `step-${index + 1}`, 80) || `step-${index + 1}`,
          title: text(item?.title ?? item?.step ?? "", 200),
          status: LEGACY_PLAN_STATUSES.has(item?.status)
            ? item.status
            : "pending",
          reason: text(item?.reason ?? "", 300)
        }))
        .filter((item) => item.title)
    : [];

  if (normalized.length <= maxItems) return normalized;

  const unfinished = normalized.filter(
    (item) => !TERMINAL_LEGACY_PLAN_STATUSES.has(item.status)
  );
  const unfinishedIds = new Set(unfinished.map((item) => item.id));
  const historySlots = Math.max(0, maxItems - unfinished.length);
  const history = normalized
    .filter((item) => !unfinishedIds.has(item.id))
    .slice(-historySlots);
  const selected = new Set([
    ...unfinished.map((item) => item.id),
    ...history.map((item) => item.id)
  ]);

  return normalized.filter((item) => selected.has(item.id));
}

function sanitizeLegacySubplan(source, index, maxItems) {
  const rootStepId = text(
    source?.rootStepId ?? source?.parentId ?? `step-${index + 1}`,
    80
  );
  if (!rootStepId) return null;

  return {
    rootStepId,
    revision: Math.max(0, Math.round(Number(source?.revision) || 0)),
    archivedCount: Math.max(0, Math.round(Number(source?.archivedCount) || 0)),
    items: sanitizeLegacyPlanItems(source?.items ?? source?.plan ?? [], {
      maxItems
    }),
    updatedAt: Math.max(0, Math.round(Number(source?.updatedAt) || 0))
  };
}

export function sanitizeLegacyPlanState(source, {
  maxRootItems = MAX_LEGACY_PLAN_ITEMS,
  maxSubplans = MAX_LEGACY_SUBPLANS,
  maxSubplanItems = MAX_LEGACY_PLAN_ITEMS
} = {}) {
  if (Array.isArray(source)) {
    return {
      schemaVersion: LEGACY_PLAN_SCHEMA_VERSION,
      rootPlanId: "",
      revision: 0,
      rootRevision: 0,
      authorityRevision: 0,
      replanRevision: 0,
      rootArchivedCount: Math.max(0, source.length - maxRootItems),
      rootItems: sanitizeLegacyPlanItems(source, { maxItems: maxRootItems }),
      subplans: [],
      lastReplan: null,
      readOnly: true
    };
  }

  const input = source && typeof source === "object" ? source : {};
  const rootSource =
    input.rootItems ??
    input.root?.items ??
    input.items ??
    input.plan ??
    [];
  const rootItems = sanitizeLegacyPlanItems(rootSource, {
    maxItems: maxRootItems
  });
  const rawSubplans = Array.isArray(input.subplans)
    ? input.subplans
    : input.stepWork && typeof input.stepWork === "object"
      ? Object.entries(input.stepWork).map(([rootStepId, value]) => ({
          rootStepId,
          ...(value && typeof value === "object" ? value : {})
        }))
      : [];
  const deduped = new Map();

  rawSubplans.forEach((entry, index) => {
    const normalized = sanitizeLegacySubplan(entry, index, maxSubplanItems);
    if (normalized) deduped.set(normalized.rootStepId, normalized);
  });

  return {
    schemaVersion: LEGACY_PLAN_SCHEMA_VERSION,
    rootPlanId: text(input.rootPlanId ?? input.root?.id, 160),
    revision: Math.max(0, Math.round(Number(input.revision) || 0)),
    rootRevision: Math.max(
      0,
      Math.round(Number(input.rootRevision ?? input.root?.revision) || 0)
    ),
    authorityRevision: Math.max(
      0,
      Math.round(Number(input.authorityRevision) || 0)
    ),
    replanRevision: Math.max(
      0,
      Math.round(Number(input.replanRevision) || 0)
    ),
    rootArchivedCount:
      Math.max(
        0,
        Math.round(
          Number(input.rootArchivedCount ?? input.root?.archivedCount) || 0
        )
      ) + Math.max(0, (Array.isArray(rootSource) ? rootSource.length : 0) - rootItems.length),
    rootItems,
    subplans: [...deduped.values()].slice(-maxSubplans),
    lastReplan: sanitizeLegacyReplan(input.lastReplan),
    readOnly: true
  };
}

export function legacyRootPlan(source, options = {}) {
  return clone(sanitizeLegacyPlanState(source, options).rootItems);
}

export function activeLegacySubplan(source, options = {}) {
  const state = sanitizeLegacyPlanState(source, options);
  const active = state.rootItems.find((item) => item.status === "in_progress");
  if (!active) return null;
  return state.subplans.find((entry) => entry.rootStepId === active.id) ?? null;
}
