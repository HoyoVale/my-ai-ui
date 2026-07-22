export const PLAN_SCHEMA_VERSION = 3;

export const PLAN_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "needs_input",
  "skipped",
  "cancelled",
  "superseded"
]);

export const TERMINAL_PLAN_STATUSES = new Set([
  "completed",
  "blocked",
  "needs_input",
  "skipped",
  "cancelled",
  "superseded"
]);

export const MAX_RETAINED_PLAN_ITEMS = 40;
export const MAX_RETAINED_SUBPLANS = 24;

function clone(value) {
  return structuredClone(value);
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

function sanitizeReplan(source) {
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

export function normalizePlanItems(items) {
  return Array.isArray(items)
    ? items
        .map((item, index) => ({
          id: text(item?.id ?? `step-${index + 1}`, 80) || `step-${index + 1}`,
          title: text(item?.title ?? item?.step ?? "", 200),
          status: PLAN_STATUSES.has(item?.status)
            ? item.status
            : "pending",
          reason: text(item?.reason ?? "", 300)
        }))
        .filter((item) => item.title)
    : [];
}

export function validatePlanItems(items, { label = "计划" } = {}) {
  const ids = new Set();

  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`${label}步骤 id 重复：${item.id}`);
    }
    ids.add(item.id);
  }

  const activeItems = items.filter((item) => item.status === "in_progress");
  if (activeItems.length > 1) {
    throw new Error(`${label}中最多只能有一个进行中的项目。`);
  }

  const unfinished = items.filter((item) =>
    ["pending", "in_progress"].includes(item.status)
  );
  if (unfinished.length > 0 && activeItems.length !== 1) {
    throw new Error(
      `${label}存在未完成项目时，必须且只能有一个进行中的步骤。请将当前步骤设为 in_progress。`
    );
  }
}

export function mergePlanRevision(previousItems, nextItems, reason = "") {
  const incomingIds = new Set(nextItems.map((item) => item.id));
  const retained = previousItems
    .filter((item) => !incomingIds.has(item.id))
    .map((item) => {
      if (TERMINAL_PLAN_STATUSES.has(item.status)) {
        return item;
      }
      return {
        ...item,
        status: "superseded",
        reason: reason || "已由新的计划修订替代。"
      };
    });
  const availableHistory = Math.max(
    0,
    MAX_RETAINED_PLAN_ITEMS - nextItems.length
  );
  const boundedRetained = availableHistory > 0
    ? retained.slice(-availableHistory)
    : [];

  return {
    items: [...nextItems, ...boundedRetained],
    archivedCount: Math.max(0, retained.length - boundedRetained.length)
  };
}

export function boundPlanItems(items) {
  if (items.length <= MAX_RETAINED_PLAN_ITEMS) {
    return { items, archivedCount: 0 };
  }

  const essential = items.filter((item) =>
    !TERMINAL_PLAN_STATUSES.has(item.status)
  );
  const essentialIds = new Set(essential.map((item) => item.id));
  const historySlots = Math.max(
    0,
    MAX_RETAINED_PLAN_ITEMS - essential.length
  );
  const history = items
    .filter((item) => !essentialIds.has(item.id))
    .slice(-historySlots);
  const selectedIds = new Set([
    ...essential.map((item) => item.id),
    ...history.map((item) => item.id)
  ]);
  const bounded = items.filter((item) => selectedIds.has(item.id));

  return {
    items: bounded,
    archivedCount: Math.max(0, items.length - bounded.length)
  };
}

function normalizeSubplan(source, index) {
  const rootStepId = text(
    source?.rootStepId ?? source?.parentId ?? `step-${index + 1}`,
    80
  );
  if (!rootStepId) {
    return null;
  }

  const bounded = boundPlanItems(
    normalizePlanItems(source?.items ?? source?.plan ?? [])
  );

  return {
    rootStepId,
    revision: Math.max(0, Math.round(Number(source?.revision) || 0)),
    archivedCount:
      Math.max(0, Math.round(Number(source?.archivedCount) || 0)) +
      bounded.archivedCount,
    items: bounded.items,
    updatedAt: Math.max(0, Math.round(Number(source?.updatedAt) || 0))
  };
}

export function normalizePlanState(source) {
  if (Array.isArray(source)) {
    const bounded = boundPlanItems(normalizePlanItems(source));
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      rootPlanId: "",
      revision: 0,
      rootRevision: 0,
      authorityRevision: 0,
      replanRevision: 0,
      rootArchivedCount: bounded.archivedCount,
      rootItems: bounded.items,
      subplans: [],
      lastReplan: null
    };
  }

  const input = source && typeof source === "object" ? source : {};
  const rootSource =
    input.rootItems ??
    input.root?.items ??
    input.items ??
    input.plan ??
    [];
  const boundedRoot = boundPlanItems(normalizePlanItems(rootSource));
  const rawSubplans = Array.isArray(input.subplans)
    ? input.subplans
    : input.stepWork && typeof input.stepWork === "object"
      ? Object.entries(input.stepWork).map(([rootStepId, value]) => ({
          rootStepId,
          ...(value && typeof value === "object" ? value : {})
        }))
      : [];
  const dedupedSubplans = new Map();

  rawSubplans.forEach((entry, index) => {
    const normalized = normalizeSubplan(entry, index);
    if (normalized) {
      dedupedSubplans.set(normalized.rootStepId, normalized);
    }
  });

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    rootPlanId: text(
      input.rootPlanId ?? input.root?.id,
      160
    ),
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
      ) + boundedRoot.archivedCount,
    rootItems: boundedRoot.items,
    subplans: [...dedupedSubplans.values()].slice(-MAX_RETAINED_SUBPLANS),
    lastReplan: sanitizeReplan(input.lastReplan)
  };
}

export function rootPlanFromState(source) {
  return clone(normalizePlanState(source).rootItems);
}

export function activeRootStep(source) {
  return normalizePlanState(source).rootItems.find(
    (item) => item.status === "in_progress"
  ) ?? null;
}

export function activeSubplan(source) {
  const state = normalizePlanState(source);
  const root = state.rootItems.find((item) => item.status === "in_progress");
  if (!root) {
    return null;
  }
  return state.subplans.find((entry) => entry.rootStepId === root.id) ?? null;
}

export function compactPlanState(source, {
  maxRootItems = 20,
  maxSubplans = 12,
  maxSubplanItems = 20
} = {}) {
  const state = normalizePlanState(source);
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    rootPlanId: state.rootPlanId,
    revision: state.revision,
    rootRevision: state.rootRevision,
    authorityRevision: state.authorityRevision,
    replanRevision: state.replanRevision,
    rootArchivedCount: state.rootArchivedCount,
    rootItems: state.rootItems.slice(0, maxRootItems),
    subplans: state.subplans.slice(-maxSubplans).map((entry) => ({
      rootStepId: entry.rootStepId,
      revision: entry.revision,
      archivedCount: entry.archivedCount,
      updatedAt: entry.updatedAt,
      items: entry.items.slice(0, maxSubplanItems)
    })),
    lastReplan: state.lastReplan
  };
}

export function interruptPlanState(source, reason) {
  const state = normalizePlanState(source);
  const message = text(reason, 300) || "应用退出导致执行中断";
  const mark = (items) => items.map((item) =>
    item.status === "in_progress"
      ? { ...item, status: "blocked", reason: item.reason || message }
      : item
  );

  return {
    ...state,
    revision: state.revision + 1,
    rootRevision: state.rootRevision + 1,
    authorityRevision: state.authorityRevision + 1,
    rootItems: mark(state.rootItems),
    subplans: state.subplans.map((entry) => ({
      ...entry,
      revision: entry.revision + 1,
      items: mark(entry.items),
      updatedAt: Date.now()
    }))
  };
}
