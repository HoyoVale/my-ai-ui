import { z } from "zod";

export function createAgentUtilityToolDefinitions({
  resultStore = null
} = {}) {
  return [
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
              code: "TOOL_RESULT_STORE_UNAVAILABLE",
              message: "当前 Agent Run 没有可用的工具结果存储。",
              retryable: false
            }
          };
        }

        return resultStore.read(
          input.resultId,
          {
            offset: input.offset ?? 0,
            limit: input.limit ?? 8000
          }
        );
      }
    }
  ];
}
