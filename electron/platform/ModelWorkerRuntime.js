import path from "node:path";

import {
  generateText,
  stepCountIs
} from "ai";

import {
  createModelRuntime
} from "../agent/modelFactory.js";

import {
  resolveWorkerModelSettings
} from "../settings/modelSettings.js";

import {
  createAgentToolSession
} from "../tools/index.js";

const ROLE_INSTRUCTIONS = Object.freeze({
  planner: "只分析目标并给出可执行的任务分解，不修改文件。",
  explorer: "只读探索代码，定位相关文件、约束和风险，不修改文件。",
  implementer: "在隔离 worktree 中完成指定实现，并运行与改动相关的验证。",
  tester: "验证指定提交，记录真实命令、结果和失败原因；不要修复实现。",
  reviewer: [
    "独立审查最终 diff、范围、风险与验收覆盖；不要修改实现。",
    "最终回复必须只包含一个 JSON 对象：",
    '{"approved":boolean,"summary":"结论","findings":["问题"],"evidence":["证据"]}',
    "存在未解决风险、越界修改或证据不足时 approved 必须为 false。"
  ].join("\n"),
  integrator: "仅按给定提交进行集成，禁止擅自覆盖冲突。",
  replanner: "独立分析已分类失败，只提出受约束的修复任务图，不修改文件。"
});

function workerSettings(settings, worktreePath) {
  const cloned = structuredClone(settings ?? {});
  cloned.tools = {
    ...(cloned.tools ?? {}),
    mode: "coding",
    profile: "workspace",
    workspace: {
      ...(cloned.tools?.workspace ?? {}),
      roots: [worktreePath]
    }
  };
  cloned.activeWorkspace = {
    id: "worker-worktree",
    name: path.basename(worktreePath),
    rootPath: worktreePath,
    canonicalPath: worktreePath
  };
  return cloned;
}

function evidenceFromRecords(records) {
  return records
    .filter((record) => record?.status === "completed")
    .slice(-20)
    .map((record) => `${record.name}: ${record.status}`);
}

export class ModelWorkerRuntime {
  constructor({
    getSettings,
    getResultDirectory,
    maxSteps = 8
  } = {}) {
    if (typeof getSettings !== "function") {
      throw new TypeError("ModelWorkerRuntime requires getSettings().");
    }
    this.getSettings = getSettings;
    this.getResultDirectory = typeof getResultDirectory === "function"
      ? getResultDirectory
      : () => "";
    this.maxSteps = Math.max(1, Math.min(24, Number(maxSteps) || 8));
  }

  resolveModel() {
    return resolveWorkerModelSettings(this.getSettings().model);
  }

  async execute({
    run,
    task,
    agentRun,
    worktree,
    signal
  } = {}) {
    const settings = workerSettings(this.getSettings(), worktree.path);
    const modelSettings = resolveWorkerModelSettings(settings.model);
    const runtime = createModelRuntime(modelSettings);
    const toolSession = createAgentToolSession({
      activeModel: modelSettings,
      settings,
      abortSignal: signal,
      taskId: task.id,
      runId: agentRun.id,
      workspaceId: worktree.id,
      mode: "coding",
      segmentId: `worker-${agentRun.attempt}`,
      resultStoreDirectory: this.getResultDirectory(run.id, agentRun.id)
    });

    try {
      const result = await generateText({
        model: runtime.model,
        system: [
          "你是由 Supervisor 管理的独立 Worker。只能处理当前结构化任务，不能生成或调度子 Agent。",
          ROLE_INSTRUCTIONS[agentRun.role] ?? ROLE_INSTRUCTIONS.implementer,
          `工作目录已隔离为：${worktree.path}`,
          "结束时简洁说明完成内容、验证证据和未解决问题。"
        ].join("\n"),
        prompt: [
          `Goal: ${run.objective}`,
          `Task: ${task.title}`,
          task.instructions ? `Instructions: ${task.instructions}` : ""
        ].filter(Boolean).join("\n\n"),
        tools: toolSession.tools,
        stopWhen: stepCountIs(this.maxSteps),
        ...runtime.requestOptions,
        abortSignal: signal,
        maxOutputTokens: modelSettings.maxOutputTokens,
        temperature: modelSettings.temperature,
        maxRetries: modelSettings.maxRetries,
        timeout: { totalMs: modelSettings.timeoutMs }
      });
      const records = toolSession.getRecords();
      return {
        ok: true,
        status: "completed",
        summary: String(result.text ?? "").trim(),
        evidence: evidenceFromRecords(records),
        unresolved: [],
        finishReason: result.finishReason,
        usage: {
          inputTokens: Number(result.usage?.inputTokens) || 0,
          outputTokens: Number(result.usage?.outputTokens) || 0,
          totalTokens: Number(result.usage?.totalTokens) ||
            (Number(result.usage?.inputTokens) || 0) +
            (Number(result.usage?.outputTokens) || 0),
          steps: Array.isArray(result.steps) ? result.steps.length : 0
        },
        records,
        model: {
          providerId: modelSettings.providerId,
          modelConfigId: modelSettings.modelConfigId,
          modelId: modelSettings.model
        }
      };
    } finally {
      await toolSession.flushPersistence?.().catch(() => false);
      await toolSession.closePersistence?.().catch(() => false);
    }
  }
}
