import {
  z
} from "zod";

export class RunPlanStore {
  constructor() {
    this.items = [];
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

export function createAgentToolDefinitions() {
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
        "Ask the user a necessary clarification question when the task cannot be completed safely or accurately without more information. Calling this tool ends the current tool loop; the user can answer in the next message.",
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
    }
  ];
}
