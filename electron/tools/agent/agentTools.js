import {
  z
} from "zod";

import {
  createDecisionKey
} from "./askUserPolicy.js";

function clone(value) {
  return structuredClone(value);
}

function normalizePlanItems(items) {
  return Array.isArray(items)
    ? items.map((item) => ({
        id: String(item.id),
        title: String(item.title),
        status: item.status
      }))
    : [];
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

  update(items) {
    const normalized =
      normalizePlanItems(items);
    const previous = this.getExecutionState();

    this.validate(normalized);
    this.items = clone(normalized);

    const next = this.getExecutionState();
    const madeProgress =
      next.completed > previous.completed ||
      next.active?.id !== previous.active?.id ||
      next.blocked < previous.blocked;

    if (madeProgress) {
      this.noteProgress();
    }

    const plan = this.get();
    this.onChange?.(plan);

    return plan;
  }

  get() {
    return clone(this.items);
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
    const completed = items.filter(
      (item) =>
        item.status === "completed"
    ).length;
    const blocked = items.filter(
      (item) =>
        item.status === "blocked"
    ).length;
    const unfinished = items.filter(
      (item) =>
        [
          "pending",
          "in_progress"
        ].includes(item.status)
    );

    return {
      items,
      active,
      next,
      completed,
      blocked,
      total: items.length,
      hasPlan: items.length > 0,
      hasUnfinished:
        unfinished.length > 0,
      canFinish:
        items.length === 0 ||
        unfinished.length === 0
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
        "Create and actively maintain the execution plan for multi-step work. The plan is an execution contract, not a report: keep exactly one unfinished item in_progress, complete it before advancing, then mark the next item in_progress. Do not finish the response while pending or in_progress items remain unless blocked or waiting for the user.",
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
              "blocked"
            ])
          })
        ).min(1).max(20)
      }),
      async execute(
        input,
        context
      ) {
        const items =
          context.planStore
            .update(input.items);

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
        const options =
          input.options ?? [];

        const requested =
          context.planStore
            .requestQuestion({
              question:
                input.question,
              decisionId:
                input.decisionId ?? "",
              reason:
                input.reason ?? "",
              options,
              selectionMode:
                input.selectionMode ??
                "single",
              allowOther:
                input.allowOther ??
                options.length === 0
            });

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
