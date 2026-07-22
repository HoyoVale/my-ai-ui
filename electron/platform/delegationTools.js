import {
  z
} from "zod";

import {
  WORKER_RUNTIME_DEFAULTS
} from "../../src/shared/runtimeDefaults.js";

import {
  getSettings
} from "../settings/settingsStore.js";

import {
  multiAgentSupervisor,
  platformJobScheduler,
  platformKernel
} from "./index.js";

const taskSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(300),
  role: z.enum([
    "planner",
    "explorer",
    "implementer",
    "tester",
    "reviewer"
  ]).default("implementer"),
  dependencies: z.array(z.string().min(1).max(80)).max(12).default([]),
  instructions: z.string().max(4000).optional(),
  maxAttempts: z.number().int().min(1).max(3).optional()
});

export function createDelegationToolDefinition({
  getPlatformRunId
} = {}) {
  return {
    name: "delegate_tasks",
    title: "Delegate tasks to Worker agents",
    description:
      "Delegate independent, bounded Coding tasks to isolated Worker agents. Use this only when two or more tasks can be separated safely, or when an independent explorer/tester/reviewer materially improves the result. Dependencies must refer to earlier task ids in this same call. Workers cannot create child agents. Wait for the structured handoffs before integrating their conclusions.",
    source: "builtin.platform.multi-agent",
    toolsets: ["agent.internal"],
    sideEffect: "write",
    riskLevel: "medium",
    inputSchema: z.object({
      tasks: z.array(taskSchema).min(1).max(4)
    }),
    outputSchema: z.object({}).passthrough(),
    async execute(input) {
      const platformRunId = String(getPlatformRunId?.() ?? "").trim();
      const run = platformKernel.getRun(platformRunId);
      if (!run || run.mode !== "coding") {
        return {
          ok: false,
          code: "multi-agent-coding-goal-required",
          message: "只有绑定 Git 工作区的 Coding Goal 可以启动 Worker。"
        };
      }
      const added = multiAgentSupervisor.addTasks(platformRunId, input.tasks);
      if (!added.ok) {
        return {
          ok: false,
          code: "multi-agent-task-graph-invalid",
          results: added.results
        };
      }
      const requestedIds = input.tasks.map((task) => task.id);
      const assignments = getSettings().model?.runtimeAssignments ?? {};
      const queued = platformJobScheduler.enqueue(platformRunId, {
        type: "delegation-workflow",
        title: `执行 ${requestedIds.length} 个 Worker 任务并完成审查`,
        payload: { taskIds: requestedIds },
        maxAttempts: 3,
        budget: {
          tokenLimit: assignments.tokenBudget ?? WORKER_RUNTIME_DEFAULTS.tokenBudget,
          stepLimit: assignments.stepBudget ?? WORKER_RUNTIME_DEFAULTS.stepBudget,
          timeLimitMs: (
            assignments.timeBudgetMinutes ??
            WORKER_RUNTIME_DEFAULTS.timeBudgetMinutes
          ) * 60 * 1000
        }
      });
      if (!queued.ok) return queued;
      const scheduled = await platformJobScheduler.wait(queued.job.id);
      const workflow = scheduled.result ?? {};
      const execution = workflow.execution ?? {
        completed: false,
        blockedTaskIds: requestedIds
      };
      const integration = workflow.integration ?? null;
      const latest = platformKernel.getRun(platformRunId);
      const tasks = requestedIds.map((id) => latest.tasks[id]).filter(Boolean);
      const agentRuns = Object.values(latest.agentRuns)
        .filter((agent) => requestedIds.includes(agent.taskId))
        .map((agent) => ({
          id: agent.id,
          taskId: agent.taskId,
          role: agent.role,
          status: agent.status,
          modelSelection: agent.modelSelection,
          outputCommit: agent.handoff?.outputCommit ?? null,
          summary: agent.handoff?.summary ?? "",
          evidence: agent.handoff?.evidence ?? [],
          unresolved: agent.handoff?.unresolved ?? []
        }));
      return {
        ok: tasks.every((task) => task.status === "completed") &&
          scheduled.ok === true &&
          (integration?.ok ?? true),
        job: {
          id: queued.job.id,
          status: platformKernel.getJob(queued.job.id)?.status ?? "unknown"
        },
        tasks: tasks.map((task) => ({
          id: task.id,
          status: task.status,
          attemptCount: task.attemptCount,
          statusReason: task.statusReason
        })),
        agentRuns,
        integration: integration
          ? {
              required: integration.required === true,
              status: integration.integration?.status ?? null,
              commit: integration.integration?.commit ?? null,
              conflicts: integration.integration?.conflicts ?? [],
              reviewApproved: integration.review?.approved === true,
              reviewSummary: integration.review?.summary ?? "",
              code: integration.code ?? null
            }
          : null,
        blockedTaskIds: execution.blockedTaskIds
          .filter((id) => requestedIds.includes(id))
      };
    }
  };
}
