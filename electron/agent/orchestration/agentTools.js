import {
  z
} from "zod";

import {
  MAX_RETAINED_SUBPLANS,
  PLAN_SCHEMA_VERSION,
  TERMINAL_PLAN_STATUSES,
  mergePlanRevision,
  normalizePlanItems,
  normalizePlanState,
  validatePlanItems
} from "../planState.js";

function clone(value) {
  return structuredClone(value);
}

function reportPlanObserverError(error) {
  console.warn(
    "任务计划更新监听器执行失败：",
    error
  );
}

export class RunPlanStore {
  constructor(
    initialState = [],
    { onChange = null } = {}
  ) {
    const normalized = normalizePlanState(initialState);
    this.rootItems = normalized.rootItems;
    this.rootArchivedCount = normalized.rootArchivedCount;
    this.subplans = new Map(
      normalized.subplans.map((entry) => [entry.rootStepId, entry])
    );
    this.revision = normalized.revision;
    this.rootRevision = normalized.rootRevision;
    this.lastChange = null;
    this.onChange = onChange;
  }

  notify(change) {
    const roots = this.get();
    const planState = this.getState();
    this.lastChange = {
      revision: this.revision,
      rootRevision: this.rootRevision,
      changedAt: Date.now(),
      ...change,
      plan: roots,
      planState
    };

    try {
      const notification = this.onChange?.(
        roots,
        clone(this.lastChange)
      );
      if (notification && typeof notification.then === "function") {
        void notification.catch(reportPlanObserverError);
      }
    } catch (error) {
      reportPlanObserverError(error);
    }

    return roots;
  }

  reconcileSubplansWithRoots(reason = "") {
    const rootById = new Map(this.rootItems.map((item) => [item.id, item]));
    const timestamp = Date.now();

    for (const [rootStepId, entry] of this.subplans) {
      const root = rootById.get(rootStepId);
      if (root?.status === "in_progress") {
        continue;
      }
      let changed = false;
      const items = entry.items.map((item) => {
        if (!["pending", "in_progress"].includes(item.status)) {
          return item;
        }
        changed = true;
        return {
          ...item,
          status: "superseded",
          reason:
            item.reason ||
            reason ||
            "所属总计划步骤已经结束。"
        };
      });
      if (changed) {
        this.subplans.set(rootStepId, {
          ...entry,
          revision: entry.revision + 1,
          items,
          updatedAt: timestamp
        });
      }
    }
  }

  update(items, { reason = "" } = {}) {
    const incoming = normalizePlanItems(items);
    const merged = mergePlanRevision(
      this.rootItems,
      incoming,
      String(reason ?? "").trim()
    );
    validatePlanItems(merged.items, { label: "总计划" });
    this.rootItems = clone(merged.items);
    this.rootArchivedCount += merged.archivedCount;
    this.revision += 1;
    this.rootRevision += 1;
    this.reconcileSubplansWithRoots(String(reason ?? "").trim());

    return this.notify({
      scope: "root",
      reason: String(reason ?? "").trim()
    });
  }

  updateStepWork(rootStepId, items, { reason = "" } = {}) {
    const targetId = String(rootStepId ?? "").trim();
    const root = this.rootItems.find((item) => item.id === targetId);
    if (!root) {
      const error = new Error(`找不到总计划步骤：${targetId}`);
      error.code = "PLAN_ROOT_STEP_NOT_FOUND";
      throw error;
    }
    if (root.status !== "in_progress") {
      const error = new Error(
        "只有当前进行中的总计划步骤可以更新内部子计划。"
      );
      error.code = "PLAN_ROOT_STEP_NOT_ACTIVE";
      throw error;
    }

    const incoming = normalizePlanItems(items);
    const previous = this.subplans.get(targetId) ?? {
      rootStepId: targetId,
      revision: 0,
      archivedCount: 0,
      items: [],
      updatedAt: 0
    };
    const merged = mergePlanRevision(
      previous.items,
      incoming,
      String(reason ?? "").trim()
    );
    validatePlanItems(merged.items, { label: "内部子计划" });

    this.subplans.set(targetId, {
      rootStepId: targetId,
      revision: previous.revision + 1,
      archivedCount: previous.archivedCount + merged.archivedCount,
      items: clone(merged.items),
      updatedAt: Date.now()
    });
    while (this.subplans.size > MAX_RETAINED_SUBPLANS) {
      const oldest = this.subplans.keys().next().value;
      this.subplans.delete(oldest);
    }
    this.revision += 1;

    this.notify({
      scope: "step_work",
      rootStepId: targetId,
      reason: String(reason ?? "").trim()
    });

    return this.getStepWork(targetId);
  }

  get() {
    return clone(this.rootItems);
  }

  getState() {
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      revision: this.revision,
      rootRevision: this.rootRevision,
      rootArchivedCount: this.rootArchivedCount,
      rootItems: this.get(),
      subplans: [...this.subplans.values()].map((entry) => clone(entry))
    };
  }

  getStepWork(rootStepId = "") {
    const targetId = String(rootStepId ?? "").trim() ||
      this.getExecutionState().active?.id ||
      "";
    const entry = this.subplans.get(targetId);
    return entry ? clone(entry) : null;
  }

  getLastChange() {
    return this.lastChange ? clone(this.lastChange) : null;
  }

  getExecutionState() {
    const items = this.get();
    const active = items.find((item) => item.status === "in_progress") ?? null;
    const next = items.find((item) => item.status === "pending") ?? null;
    const count = (status) => items.filter((item) => item.status === status).length;
    const completed = count("completed");
    const blocked = count("blocked");
    const needsInput = count("needs_input");
    const skipped = count("skipped");
    const cancelled = count("cancelled");
    const superseded = count("superseded");
    const unfinished = items.filter((item) =>
      ["pending", "in_progress"].includes(item.status)
    );
    const terminal = items.filter((item) =>
      TERMINAL_PLAN_STATUSES.has(item.status)
    ).length;
    const stepWork = active ? this.getStepWork(active.id) : null;

    return {
      items,
      active,
      next,
      stepWork,
      completed,
      blocked,
      needsInput,
      skipped,
      cancelled,
      superseded,
      terminal,
      archived: this.rootArchivedCount,
      total: items.length,
      hasPlan: items.length > 0,
      hasUnfinished: unfinished.length > 0,
      canFinish: items.length === 0 || unfinished.length === 0,
      isSuccessful:
        items.length === 0 ||
        (
          unfinished.length === 0 &&
          blocked === 0 &&
          needsInput === 0 &&
          cancelled === 0
        )
    };
  }

  canRunTool(toolName) {
    if (["update_plan", "update_step_work", "read_tool_result"].includes(toolName)) {
      return { ok: true, step: this.getExecutionState().active };
    }

    const state = this.getExecutionState();
    if (state.hasPlan && !state.active) {
      return {
        ok: false,
        code: "PLAN_STEP_REQUIRED",
        message:
          "总计划尚未指定进行中的步骤。请先调用 update_plan，将当前总步骤设为 in_progress。"
      };
    }

    return { ok: true, step: state.active };
  }
}

export function createAgentToolDefinitions({
  resultStore = null,
  planStore = null
} = {}) {
  const planItemSchema = z.object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    status: z.enum([
      "pending",
      "in_progress",
      "completed",
      "blocked",
      "needs_input",
      "skipped",
      "cancelled",
      "superseded"
    ]),
    reason: z.string().max(300).optional()
  });

  return [
    {
      name: "update_plan",
      title: "Update task plan",
      description:
        "Create and revise the user-visible root task plan for multi-step work. Keep the root plan concise and stable, normally 3-8 outcome-oriented steps. Keep exactly one unfinished root item in_progress. Do not append low-level execution details here; use update_step_work for the internal breakdown of the active root step. Preserve completed root work. When required user input is missing, mark the current root item needs_input. Do not finish while root items remain pending or in_progress.",
      inputSchema: z.object({
        items: z.array(planItemSchema).min(1).max(20),
        reason: z.string()
          .max(500)
          .optional()
      }),
      outputSchema: z.object({
        items: z.array(z.object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
          reason: z.string()
        })),
        execution: z.object({}).passthrough()
      }),
      async execute(input) {
        if (!planStore) {
          const error = new Error(
            "当前 Agent Run 没有可用的计划存储。"
          );
          error.code = "PLAN_STORE_UNAVAILABLE";
          throw error;
        }
        const items =
          planStore
            .update(
              input.items,
              {
                reason:
                  input.reason ?? ""
              }
            );

        return {
          items,
          execution:
            planStore
              .getExecutionState()
        };
      }
    },
    {
      name: "update_step_work",
      title: "Update internal step work",
      description:
        "Create or revise the internal subplan for the currently in_progress root plan step. Use it for detailed execution tasks discovered while working. This subplan is not shown in the normal user plan dock and never determines whether the whole run may finish; only the root plan does. Keep exactly one unfinished sub-item in_progress.",
      inputSchema: z.object({
        rootStepId: z.string().min(1).max(80),
        items: z.array(planItemSchema).min(1).max(20),
        reason: z.string().max(500).optional()
      }),
      outputSchema: z.object({
        rootStepId: z.string(),
        revision: z.number(),
        archivedCount: z.number(),
        items: z.array(z.object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
          reason: z.string()
        })),
        rootExecution: z.object({}).passthrough()
      }),
      async execute(input) {
        if (!planStore) {
          const error = new Error(
            "当前 Agent Run 没有可用的计划存储。"
          );
          error.code = "PLAN_STORE_UNAVAILABLE";
          throw error;
        }

        const stepWork = planStore.updateStepWork(
          input.rootStepId,
          input.items,
          { reason: input.reason ?? "" }
        );

        return {
          ...stepWork,
          rootExecution: planStore.getExecutionState()
        };
      }
    },
    {
      name: "read_tool_result",
      title: "Read tool result",
      description:
        "Read another chunk from a large tool result saved during the current Agent run. Use the resultId returned by a truncated tool result.",
      inputSchema: z.object({
        resultId: z.string()
          .min(1)
          .max(120),
        offset: z.number()
          .int()
          .min(0)
          .optional(),
        limit: z.number()
          .int()
          .min(500)
          .max(12000)
          .optional()
      }),
      outputSchema: z.object({}).passthrough(),
      async execute(input) {
        if (!resultStore) {
          return {
            ok: false,
            error: {
              code:
                "TOOL_RESULT_STORE_UNAVAILABLE",
              message:
                "当前 Agent Run 没有可用的工具结果存储。",
              retryable: false
            }
          };
        }

        return resultStore.read(
          input.resultId,
          {
            offset:
              input.offset ?? 0,
            limit:
              input.limit ?? 8000
          }
        );
      }
    }
  ];
}
