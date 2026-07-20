import {
  z
} from "zod";

function clone(value) {
  return structuredClone(value);
}

function reportPlanObserverError(error) {
  console.warn(
    "任务计划更新监听器执行失败：",
    error
  );
}

const PLAN_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "needs_input",
  "skipped",
  "cancelled",
  "superseded"
]);

const MAX_RETAINED_PLAN_ITEMS = 40;

const TERMINAL_PLAN_STATUSES = new Set([
  "completed",
  "blocked",
  "needs_input",
  "skipped",
  "cancelled",
  "superseded"
]);

function normalizePlanItems(items) {
  return Array.isArray(items)
    ? items.map((item, index) => ({
        id:
          String(
            item?.id ??
            `step-${index + 1}`
          ).trim() ||
          `step-${index + 1}`,
        title:
          String(
            item?.title ?? ""
          ).trim(),
        status:
          PLAN_STATUSES.has(
            item?.status
          )
            ? item.status
            : "pending",
        reason:
          String(
            item?.reason ?? ""
          ).trim()
      }))
      .filter((item) => item.title)
    : [];
}

function mergePlanRevision(
  previousItems,
  nextItems,
  reason = ""
) {
  const incomingIds = new Set(
    nextItems.map((item) => item.id)
  );
  const retained = previousItems
    .filter((item) =>
      !incomingIds.has(item.id)
    )
    .map((item) => {
      if (
        TERMINAL_PLAN_STATUSES.has(
          item.status
        )
      ) {
        return item;
      }

      return {
        ...item,
        status: "superseded",
        reason:
          reason ||
          "已由新的计划修订替代。"
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
    items: [
      ...nextItems,
      ...boundedRetained
    ],
    archivedCount:
      Math.max(0, retained.length - boundedRetained.length)
  };
}

function boundInitialPlan(items) {
  if (items.length <= MAX_RETAINED_PLAN_ITEMS) {
    return {
      items,
      archivedCount: 0
    };
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

export class RunPlanStore {
  constructor(
    initialItems = [],
    {
      onChange = null
    } = {}
  ) {
    const initial = boundInitialPlan(
      normalizePlanItems(initialItems)
    );
    this.items = initial.items;
    this.archivedCount = initial.archivedCount;
    this.revision = 0;
    this.lastChange = null;
    this.onChange = onChange;
  }

  validate(items) {
    const ids = new Set();

    for (const item of items) {
      if (ids.has(item.id)) {
        throw new Error(
          `计划步骤 id 重复：${item.id}`
        );
      }
      ids.add(item.id);
    }

    const activeItems = items.filter(
      (item) =>
        item.status ===
        "in_progress"
    );

    if (activeItems.length > 1) {
      throw new Error(
        "计划中最多只能有一个进行中的项目。"
      );
    }

    const unfinished = items.filter(
      (item) =>
        [
          "pending",
          "in_progress"
        ].includes(item.status)
    );

    if (
      unfinished.length > 0 &&
      activeItems.length !== 1
    ) {
      throw new Error(
        "未完成的计划必须且只能有一个进行中的步骤。请将当前步骤设为 in_progress。"
      );
    }
  }

  update(
    items,
    {
      reason = ""
    } = {}
  ) {
    const incoming =
      normalizePlanItems(items);
    const merged =
      mergePlanRevision(
        this.items,
        incoming,
        String(reason ?? "").trim()
      );
    this.validate(merged.items);
    this.items = clone(merged.items);
    this.archivedCount += merged.archivedCount;
    this.revision += 1;

    const plan = this.get();
    this.lastChange = {
      revision: this.revision,
      reason:
        String(reason ?? "").trim(),
      changedAt: Date.now(),
      plan
    };
    try {
      const notification =
        this.onChange?.(
          plan,
          clone(this.lastChange)
        );

      if (
        notification &&
        typeof notification.then === "function"
      ) {
        void notification.catch(
          reportPlanObserverError
        );
      }
    } catch (error) {
      reportPlanObserverError(error);
    }

    return plan;
  }

  get() {
    return clone(this.items);
  }

  getLastChange() {
    return this.lastChange
      ? clone(this.lastChange)
      : null;
  }

  getExecutionState() {
    const items = this.get();
    const active = items.find(
      (item) =>
        item.status ===
        "in_progress"
    ) ?? null;
    const next = items.find(
      (item) =>
        item.status === "pending"
    ) ?? null;
    const count = (status) =>
      items.filter(
        (item) =>
          item.status === status
      ).length;
    const completed = count("completed");
    const blocked = count("blocked");
    const needsInput = count("needs_input");
    const skipped = count("skipped");
    const cancelled = count("cancelled");
    const superseded = count("superseded");
    const unfinished = items.filter(
      (item) =>
        [
          "pending",
          "in_progress"
        ].includes(item.status)
    );
    const terminal = items.filter(
      (item) =>
        TERMINAL_PLAN_STATUSES.has(
          item.status
        )
    ).length;

    return {
      items,
      active,
      next,
      completed,
      blocked,
      needsInput,
      skipped,
      cancelled,
      superseded,
      terminal,
      archived: this.archivedCount,
      total: items.length,
      hasPlan: items.length > 0,
      hasUnfinished:
        unfinished.length > 0,
      canFinish:
        items.length === 0 ||
        unfinished.length === 0,
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
    if (["update_plan", "read_tool_result"].includes(toolName)) {
      return {
        ok: true,
        step: this.getExecutionState()
          .active
      };
    }

    const state =
      this.getExecutionState();

    if (
      state.hasPlan &&
      !state.active
    ) {
      return {
        ok: false,
        code:
          "PLAN_STEP_REQUIRED",
        message:
          "计划尚未指定进行中的步骤。请先调用 update_plan，将当前要执行的步骤设为 in_progress。"
      };
    }

    return {
      ok: true,
      step: state.active
    };
  }


}

export function createAgentToolDefinitions({
  resultStore = null,
  planStore = null
} = {}) {
  return [
    {
      name: "update_plan",
      title: "Update task plan",
      description:
        "Create, execute, and revise the plan for multi-step work. Keep exactly one unfinished item in_progress. Preserve completed work. When required user input is missing, mark the current item needs_input and explain the missing input in the final response; do not keep calling tools. When the approach changes, mark obsolete steps skipped, cancelled, or superseded and provide a concise revision reason. Do not finish while pending or in_progress items remain.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            id: z.string()
              .min(1)
              .max(80),
            title: z.string()
              .min(1)
              .max(200),
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
            reason: z.string()
              .max(300)
              .optional()
          })
        ).min(1).max(20),
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
