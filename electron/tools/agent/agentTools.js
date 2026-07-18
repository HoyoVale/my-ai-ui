import {
  z
} from "zod";

import {
  createDecisionKey,
  normalizeAskUserRequest
} from "./askUserPolicy.js";

function clone(value) {
  return structuredClone(value);
}

const PLAN_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "skipped",
  "cancelled",
  "superseded"
]);

const TERMINAL_PLAN_STATUSES = new Set([
  "completed",
  "blocked",
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

  return [
    ...nextItems,
    ...retained
  ];
}

export class RunPlanStore {
  constructor(
    initialItems = [],
    {
      onChange = null,
      onQuestion = null,
      answeredQuestions = [],
      initialQuestionCount = 0,
      maxQuestions = 3
    } = {}
  ) {
    this.items = normalizePlanItems(
      initialItems
    );
    this.revision = 0;
    this.lastChange = null;
    this.pendingQuestion = null;
    this.onChange = onChange;
    this.onQuestion = onQuestion;
    this.maxQuestions = Math.max(
      1,
      Number(maxQuestions) || 3
    );
    this.questionCount = Math.max(
      Number(initialQuestionCount) || 0,
      Array.isArray(answeredQuestions)
        ? answeredQuestions.length
        : 0
    );
    this.answeredDecisionKeys = new Set(
      (Array.isArray(answeredQuestions)
        ? answeredQuestions
        : []
      ).map((question) =>
        question?.decisionKey ??
        createDecisionKey(question)
      ).filter(Boolean)
    );
    this.mustAdvanceAfterAnswer =
      this.answeredDecisionKeys.size > 0;
    this.progressSinceAnswer =
      !this.mustAdvanceAfterAnswer;
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
    const normalized =
      mergePlanRevision(
        this.items,
        incoming,
        String(reason ?? "").trim()
      );
    const previous =
      this.getExecutionState();

    this.validate(normalized);
    this.items = clone(normalized);
    this.revision += 1;

    const next = this.getExecutionState();
    const madeProgress =
      next.completed > previous.completed ||
      next.terminal > previous.terminal ||
      next.active?.id !== previous.active?.id ||
      next.blocked < previous.blocked;

    if (madeProgress) {
      this.noteProgress();
    }

    const plan = this.get();
    this.lastChange = {
      revision: this.revision,
      reason:
        String(reason ?? "").trim(),
      changedAt: Date.now(),
      plan
    };
    this.onChange?.(
      plan,
      clone(this.lastChange)
    );

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
      skipped,
      cancelled,
      superseded,
      terminal,
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
          cancelled === 0
        )
    };
  }

  canRunTool(toolName, input = {}) {
    if (toolName === "ask_user") {
      return this.canAskUser(input);
    }

    if (
      [
        "update_plan",
        "report_progress"
      ].includes(toolName)
    ) {
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


  noteProgress() {
    this.progressSinceAnswer = true;
  }

  noteToolExecution(toolName) {
    if (
      ![
        "ask_user",
        "report_progress",
        "update_plan"
      ].includes(toolName)
    ) {
      this.noteProgress();
    }
  }

  canAskUser(request = {}) {
    if (this.pendingQuestion) {
      return {
        ok: false,
        code: "ASK_USER_PENDING",
        retryable: true,
        message:
          "当前已经有一个等待用户回答的问题。请等待该问题得到回答。"
      };
    }

    const decisionKey =
      createDecisionKey(request);

    if (
      decisionKey &&
      this.answeredDecisionKeys.has(
        decisionKey
      )
    ) {
      return {
        ok: false,
        code:
          "ASK_USER_ALREADY_ANSWERED",
        retryable: true,
        message:
          "这个决策已经得到用户回答。请使用已有答案继续任务，不要重复提问。"
      };
    }

    if (
      this.mustAdvanceAfterAnswer &&
      !this.progressSinceAnswer
    ) {
      return {
        ok: false,
        code:
          "ASK_USER_MUST_ADVANCE",
        retryable: true,
        message:
          "用户刚刚回答了问题。下一步必须使用该答案推进计划、执行其他工具或给出最终回复，不能立刻再次调用 ask_user。"
      };
    }

    if (
      this.questionCount >=
      this.maxQuestions
    ) {
      return {
        ok: false,
        code: "ASK_USER_LIMIT",
        retryable: true,
        message:
          `当前任务最多允许提出 ${this.maxQuestions} 个用户问题。请使用已有信息继续或给出当前结果。`
      };
    }

    return {
      ok: true,
      decisionKey,
      step: this.getExecutionState()
        .active
    };
  }

  requestQuestion(request = {}) {
    const permission =
      this.canAskUser(request);

    if (!permission.ok) {
      return {
        ok: false,
        error: {
          code: permission.code,
          message: permission.message,
          retryable:
            permission.retryable === true
        }
      };
    }

    this.questionCount += 1;
    this.progressSinceAnswer = false;

    return {
      ok: true,
      request: this.setPendingQuestion({
        ...request,
        decisionKey:
          permission.decisionKey
      })
    };
  }

  setPendingQuestion(
    question
  ) {
    this.pendingQuestion =
      clone(question);

    const pending =
      this.getPendingQuestion();
    this.onQuestion?.(pending);

    return pending;
  }

  getPendingQuestion() {
    return this.pendingQuestion
      ? clone(
          this.pendingQuestion
        )
      : null;
  }
}

export function createAgentToolDefinitions({
  resultStore = null
} = {}) {
  return [
    {
      name: "report_progress",
      title: "Report progress",
      description:
        "Publish one concise user-facing progress update around a meaningful batch of tool work. Use phase=before_tools before a batch, between_tools when the direction changes, and after_tools after the batch result is understood. This is public commentary, never private chain-of-thought. Do not call it for every individual tool.",
      countsTowardLimit: false,
      inputSchema: z.object({
        message: z.string()
          .min(1)
          .max(600),
        phase: z.enum([
          "before_tools",
          "between_tools",
          "after_tools"
        ]),
        objective: z.string()
          .max(200)
          .optional()
      }),
      async execute(input, context) {
        const event = context.activityStore
          ?.recordCommentary({
            content: input.message,
            phase: input.phase,
            objective: input.objective ?? ""
          });

        return {
          status: "recorded",
          phase: input.phase,
          batchId: event?.batchId ?? ""
        };
      }
    },
    {
      name: "update_plan",
      title: "Update task plan",
      description:
        "Create, execute, and revise the plan for multi-step work. Keep exactly one unfinished item in_progress. Preserve completed work. When the approach changes, mark obsolete steps skipped, cancelled, or superseded and provide a concise revision reason. Do not finish while pending or in_progress items remain unless waiting for the user.",
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
      async execute(
        input,
        context
      ) {
        const items =
          context.planStore
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
            context.planStore
              .getExecutionState()
        };
      }
    },
    {
      name: "ask_user",
      title: "Ask user",
      description:
        "Pause the current task and ask one necessary clarification question. Ask only when missing information materially blocks execution. When testing this tool, ask exactly one question unless the user explicitly requests multiple rounds. After the user answers, consume that answer and advance the plan, run another non-question tool, or give the final response; never immediately ask another question for the same decision. When a small set of reasonable answers exists, provide 2 to 6 concise options.",
      inputSchema: z.object({
        question: z.string()
          .min(1)
          .max(1000),
        decisionId: z.string()
          .min(1)
          .max(160)
          .optional(),
        reason: z.string()
          .max(500)
          .optional(),
        options: z.array(
          z.object({
            id: z.string()
              .min(1)
              .max(80),
            label: z.string()
              .min(1)
              .max(200)
          })
        ).min(2).max(6).optional(),
        selectionMode: z.enum([
          "single",
          "multiple"
        ]).optional(),
        allowOther: z.boolean()
          .optional()
      }),
      async execute(
        input,
        context
      ) {
        const request =
          normalizeAskUserRequest({
            question:
              input.question,
            decisionId:
              input.decisionId ?? "",
            reason:
              input.reason ?? "",
            options:
              input.options ?? [],
            selectionMode:
              input.selectionMode,
            allowOther:
              input.allowOther
          });

        const requested =
          context.planStore
            .requestQuestion(request);

        if (requested.ok === false) {
          return requested;
        }

        return {
          status:
            "waiting_for_user",
          request:
            requested.request
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
