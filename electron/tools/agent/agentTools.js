import {
  z
} from "zod";

export class RunPlanStore {
  constructor(
    initialItems = []
  ) {
    this.items =
      Array.isArray(initialItems)
        ? structuredClone(
            initialItems
          )
        : [];
    this.pendingQuestion = null;
  }

  update(items) {
    this.items =
      structuredClone(items);

    return this.get();
  }

  get() {
    return structuredClone(
      this.items
    );
  }

  setPendingQuestion(
    question
  ) {
    this.pendingQuestion =
      structuredClone(question);

    return this.getPendingQuestion();
  }

  getPendingQuestion() {
    return this.pendingQuestion
      ? structuredClone(
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
      name: "update_plan",
      title: "Update task plan",
      description:
        "Create or update a concise task plan for the current agent run. Use it for multi-step work and keep exactly one item in progress when work is active.",
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
        const activeItems =
          input.items.filter(
            (item) =>
              item.status ===
              "in_progress"
          );

        if (activeItems.length > 1) {
          throw new Error(
            "计划中最多只能有一个进行中的项目。"
          );
        }

        return {
          items:
            context.planStore
              .update(
                input.items
              )
        };
      }
    },
    {
      name: "ask_user",
      title: "Ask user",
      description:
        "Ask the user a necessary clarification question when the task cannot be completed safely or accurately without more information. Calling this tool pauses the task. The next user message resumes the same task plan.",
      inputSchema: z.object({
        question: z.string()
          .min(1)
          .max(1000),
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
        ).max(6).optional()
      }),
      async execute(
        input,
        context
      ) {
        return {
          status:
            "waiting_for_user",
          request:
            context.planStore
              .setPendingQuestion({
                question:
                  input.question,
                reason:
                  input.reason ?? "",
                options:
                  input.options ?? []
              })
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
