import {
  app,
  BrowserWindow
} from "electron";

import path from "node:path";

import IPC_CHANNELS
  from "../shared/ipcChannels.cjs";

import {
  PlatformKernel
} from "./PlatformKernel.js";

import {
  WorktreeRuntime
} from "./WorktreeRuntime.js";

import {
  ModelWorkerRuntime
} from "./ModelWorkerRuntime.js";

import {
  MultiAgentSupervisor
} from "./MultiAgentSupervisor.js";

import {
  IndependentTaskEvaluator
} from "./IndependentTaskEvaluator.js";

import {
  IntegrationCoordinator
} from "./IntegrationCoordinator.js";

import {
  PlatformJobScheduler
} from "./PlatformJobScheduler.js";

import {
  LongRunningAgentService
} from "./LongRunningAgentService.js";

import {
  createElectronLongRunningLifecycleAdapter,
  deliverNativePlatformNotification
} from "./ElectronLongRunningAdapter.js";

import {
  classifyPlatformFailure
} from "./FailureClassifier.js";

import {
  IndependentReplanner
} from "./IndependentReplanner.js";

import {
  getSettings
} from "../settings/settingsStore.js";

import {
  getWorkspaceById
} from "../workspace/workspaceRegistry.js";

import {
  WORKER_RUNTIME_DEFAULTS
} from "../../src/shared/runtimeDefaults.js";

function broadcastPlatformState(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (
      window.isDestroyed() ||
      window.webContents.isDestroyed()
    ) {
      continue;
    }
    window.webContents.send(
      IPC_CHANNELS.platform.CHANGED,
      state
    );
  }
}

export const platformKernel = new PlatformKernel({
  getStorageDirectory: () => path.join(
    app.getPath("userData"),
    "platform"
  ),
  onChange: broadcastPlatformState
});

export const completionAuthority = Object.freeze({
  verify: (permit, expected) => platformKernel.verifyCompletionPermit(permit, expected)
});

export const worktreeRuntime = new WorktreeRuntime({
  getStorageDirectory: () => path.join(
    app.getPath("userData"),
    "platform",
    "worktrees"
  ),
  platformKernel
});

export const modelWorkerRuntime = new ModelWorkerRuntime({
  getSettings,
  getResultDirectory: (platformRunId, agentRunId) => path.join(
    app.getPath("userData"),
    "platform",
    "worker-results",
    String(platformRunId),
    String(agentRunId)
  )
});

function resolveWorkspaceRoot(run) {
  const workspace = getWorkspaceById(run?.workspaceId, getSettings());
  return workspace && !workspace.missing
    ? workspace.canonicalPath || workspace.rootPath
    : "";
}

export const independentTaskEvaluator = new IndependentTaskEvaluator({
  platformKernel,
  worktreeRuntime,
  evaluatorRuntime: modelWorkerRuntime,
  getWorkspaceRoot: resolveWorkspaceRoot
});

export const multiAgentSupervisor = new MultiAgentSupervisor({
  platformKernel,
  worktreeRuntime,
  workerRuntime: modelWorkerRuntime,
  taskEvaluator: independentTaskEvaluator,
  getWorkspaceRoot: resolveWorkspaceRoot,
  maxConcurrency: WORKER_RUNTIME_DEFAULTS.maxConcurrency,
  getMaxConcurrency: () =>
    getSettings().model?.runtimeAssignments?.maxConcurrency ??
      WORKER_RUNTIME_DEFAULTS.maxConcurrency
});

export const integrationCoordinator = new IntegrationCoordinator({
  platformKernel,
  worktreeRuntime,
  reviewerRuntime: modelWorkerRuntime,
  getWorkspaceRoot: resolveWorkspaceRoot
});

export const independentReplanner = new IndependentReplanner({
  platformKernel
});

export const platformJobScheduler = new PlatformJobScheduler({
  platformKernel,
  maxConcurrency: 2,
  autoStart: false,
  onPause: (job) => multiAgentSupervisor.pause(job.platformRunId),
  onResume: (job) => multiAgentSupervisor.resume(job.platformRunId),
  onCancel: (job) => multiAgentSupervisor.cancel(job.platformRunId),
  onNotification: deliverNativePlatformNotification,
  onFailure: ({ job, error, result }) => independentReplanner.replan(
    job.platformRunId,
    classifyPlatformFailure({
      code: error?.code ?? result?.code,
      stage: result?.integration ? "integration-review" : "background-job",
      message: error?.message,
      error: result?.error,
      findings: result?.integration?.review?.findings,
      conflicts: result?.integration?.integration?.conflicts
    })
  )
});

export const longRunningLifecycleAdapter = createElectronLongRunningLifecycleAdapter();

export const longRunningAgentService = new LongRunningAgentService({
  platformKernel,
  scheduler: platformJobScheduler,
  lifecycleAdapter: longRunningLifecycleAdapter
});

platformJobScheduler.register("delegation-workflow", async ({
  job,
  signal,
  log,
  consume
}) => {
  const taskIds = Array.isArray(job.payload?.taskIds)
    ? job.payload.taskIds.map(String)
    : [];
  if (signal.aborted) return { ok: false, code: "platform-job-cancelled" };
  multiAgentSupervisor.resume(job.platformRunId);
  const recoveredRun = platformKernel.getRun(job.platformRunId);
  for (const taskId of taskIds) {
    const task = recoveredRun?.tasks?.[taskId];
    if (
      ["continuable", "failed", "blocked"].includes(task?.status) &&
      task.attemptCount < task.maxAttempts
    ) {
      platformKernel.setTaskStatus(
        job.platformRunId,
        task.id,
        "ready",
        "background-job-resumed"
      );
    }
  }
  log(`Worker 队列开始执行 ${taskIds.length} 个任务。`, {
    source: "supervisor"
  });
  const execution = await multiAgentSupervisor.run(job.platformRunId, {
    taskIds,
    signal,
    onUsage: (usage) => consume(usage)
  });
  if (signal.aborted) {
    return { ok: false, code: "platform-job-budget-or-cancelled" };
  }
  if (!execution.completed) {
    return {
      ok: false,
      code: "multi-agent-workers-incomplete",
      blockedTaskIds: execution.blockedTaskIds
    };
  }
  log("Worker 已完成，进入集成与独立审查。", { source: "integration" });
  const integrationStep = consume({ steps: 1 });
  if (!integrationStep.ok || signal.aborted) {
    return { ok: false, code: "platform-job-budget-or-cancelled" };
  }
  const integration = await integrationCoordinator.integrateAndReview(
    job.platformRunId,
    {
      signal,
      onUsage: (usage) => consume(usage)
    }
  );
  return {
    ok: integration.ok === true,
    code: integration.ok === true ? null : integration.code ?? "integration-review-failed",
    summary: integration.ok
      ? "Worker 变更已集成、审查并发布。"
      : `集成或审查未通过：${integration.code ?? "unknown"}`,
    taskIds,
    execution,
    integration
  };
});
