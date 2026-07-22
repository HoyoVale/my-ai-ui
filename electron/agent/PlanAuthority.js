import {
  normalizePlanItems,
  normalizePlanState
} from "./planState.js";

const SUCCESSFUL_SUBSTEP_STATUSES = new Set([
  "completed",
  "skipped",
  "superseded"
]);

export function authoritativeRootItems(items = []) {
  return (Array.isArray(items) ? items : []).filter(
    (item) => item?.status !== "superseded"
  );
}

export function allowedPlanProgressTransition(previous, next) {
  if (previous === next) return true;
  if (previous === "pending") {
    return [
      "in_progress",
      "completed",
      "blocked",
      "needs_input",
      "skipped",
      "cancelled"
    ].includes(next);
  }
  if (previous === "in_progress") {
    return [
      "completed",
      "blocked",
      "needs_input",
      "skipped",
      "cancelled"
    ].includes(next);
  }
  if (["blocked", "needs_input"].includes(previous)) {
    return [
      "pending",
      "in_progress",
      "completed",
      "blocked",
      "needs_input",
      "skipped",
      "cancelled"
    ].includes(next);
  }
  return false;
}

export function mergePlanProgressOnly(previousItems, incomingItems) {
  const previous = authoritativeRootItems(previousItems);
  const incoming = authoritativeRootItems(incomingItems);
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const structuralChanges = [];

  for (const item of previous) {
    const next = incomingById.get(item.id);
    if (!next) {
      structuralChanges.push({ type: "removed", id: item.id });
      continue;
    }
    if (next.title !== item.title) {
      structuralChanges.push({
        type: "renamed",
        id: item.id,
        from: item.title,
        to: next.title
      });
    }
    if (!allowedPlanProgressTransition(item.status, next.status)) {
      structuralChanges.push({
        type: "status_regression",
        id: item.id,
        from: item.status,
        to: next.status
      });
    }
  }

  for (const item of incoming) {
    if (!previousById.has(item.id)) {
      structuralChanges.push({ type: "added", id: item.id });
    }
  }

  return {
    ok: structuralChanges.length === 0,
    structuralChanges,
    items: [
      ...incoming.map((item) => ({
        ...item,
        reason: item.reason || previousById.get(item.id)?.reason || ""
      })),
      ...previousItems.filter((item) => item.status === "superseded")
    ]
  };
}

function subplanSuccessful(entry) {
  const items = normalizePlanItems(entry?.items ?? []);
  return items.length > 0 && items.every(
    (item) => SUCCESSFUL_SUBSTEP_STATUSES.has(item.status)
  );
}

export function reconcileRootPlanFromSubplans(source) {
  const state = normalizePlanState(source);
  const subplans = new Map(
    state.subplans.map((entry) => [entry.rootStepId, entry])
  );
  let changed = false;
  const rootItems = state.rootItems.map((item) => {
    if (item.status !== "in_progress") return item;
    const subplan = subplans.get(item.id);
    if (!subplanSuccessful(subplan)) return item;
    changed = true;
    return {
      ...item,
      status: "completed",
      reason: item.reason || "内部执行步骤已全部完成。"
    };
  });

  if (!changed) {
    return { changed: false, state };
  }

  return {
    changed: true,
    state: {
      ...state,
      revision: state.revision + 1,
      rootRevision: state.rootRevision + 1,
      authorityRevision: state.authorityRevision + 1,
      rootItems
    }
  };
}
