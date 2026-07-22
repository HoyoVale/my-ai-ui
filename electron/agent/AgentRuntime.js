import {
  BrowserWindow
} from "electron";

import {
  generateText
} from "ai";

import crypto from "node:crypto";

import IPC_CHANNELS from "../shared/ipcChannels.cjs";

import {
  conversationManager
} from "../conversation/index.js";

import {
  getRecoveryExecutionOverrides,
  resolveConversationExecutionContext
} from "../conversation/executionContext.js";

import {
  getSettings
} from "../settings/settingsStore.js";

import {
  assembleAgentContext
} from "../context/index.js";

import {
  sanitizeSettings
} from "../settings/validateSettings.js";

import {
  resolveActiveModelSettings
} from "../settings/modelSettings.js";

import {
  isResponseSender
} from "../windows/response/index.js";

import {
  isConversationSender,
  openConversationWindow
} from "../windows/conversation/conversationWindow.js";

import {
  isInputSender
} from "../windows/input/inputWindow.js";

import {
  createModelRuntime
} from "./modelFactory.js";

import {
  formatAgentError,
  isAbortError
} from "./agentErrors.js";

import {
  createAgentToolSession
} from "../tools/createAgentToolSession.js";

import {
  ToolApprovalController
} from "../tools/security/ToolApprovalController.js";

import {
  mcpClientManager
} from "../mcp/index.js";

import {
  declarativeHttpToolManager
} from "../custom-tools/index.js";

import {
  threadRoutingDecisionStore
} from "../execution-model/index.js";

import {
  resolveSkillRuntime,
  skillRegistry
} from "../skills/index.js";

import {
  configureRuntimeCircuitBreakers,
  getRuntimeCircuitBreakerSnapshot,
  providerCircuitBreakers,
  resetRuntimeCircuitBreaker
} from "../runtime/runtimeCircuitBreakers.js";

import {
  LIVE_STEP_ROLES
} from "./stepText.js";

import {
  resolveActiveRunText
} from "./activeRunText.js";

import {
  CoalescedStatusBroadcaster
} from "./CoalescedStatusBroadcaster.js";

import {
  projectAgentSnapshot,
  projectAgentStatus,
  projectRuntimeRecovery
} from "./statusProjection.js";

import {
  createAgentSnapshotEnvelope,
  createAgentStatusPatch,
  createAgentTextEvents
} from "../../src/shared/agentStatusProtocol.js";

import {
  agentRunPreparation
} from "./preparation/AgentRunPreparation.js";

import {
  agentRunExecution
} from "./execution/AgentRunExecution.js";

import {
  agentRunFinalization
} from "./finalization/AgentRunFinalization.js";

import {
  agentRunPersistence
} from "./persistence/AgentRunPersistence.js";

import {
  getTaskResultDirectory
} from "./AgentRuntimeInternals.js";

function cloneStatus(status) {
  return {
    ...status
  };
}

function projectionTargetForWebContents(webContents) {
  if (isResponseSender(webContents)) {
    return "response";
  }

  if (isConversationSender(webContents)) {
    return "conversation";
  }

  if (isInputSender(webContents)) {
    return "input";
  }

  return "generic";
}

function providerCircuitKey(runtime) {
  const descriptor = runtime?.descriptor ?? {};
  return [
    descriptor.providerId,
    descriptor.modelConfigId,
    descriptor.modelId
  ].filter(Boolean).join(":");
}

function shouldCountProviderFailure(error) {
  if (!error || isAbortError(error)) {
    return false;
  }

  const status = Number(
    error?.statusCode ?? error?.status ?? error?.response?.status ?? 0
  );
  const code = String(error?.code ?? error?.cause?.code ?? "").toUpperCase();

  if ([400, 401, 403, 404, 422].includes(status)) {
    return false;
  }

  if (status === 408 || status === 429 || status >= 500) {
    return true;
  }

  return [
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT"
  ].includes(code) || /timeout|temporar|unavailable|network|rate limit/i.test(
    String(error?.message ?? "")
  );
}

export class AgentRuntime {
  constructor() {
    this.activeRun = null;

    this.status = {
      state: "idle",
      runId: null,
      conversationId: null,
      startedAt: null,
      lastError: null
    };
    this.statusRevision = 0;
    this.windowStatusState = new Map();
    this.statusBroadcaster = new CoalescedStatusBroadcaster({
      intervalMs: 40,
      publish: () => this.publishStatus()
    });
  }

  assertProviderAvailable(runtime) {
    const key = providerCircuitKey(runtime);
    if (!key) {
      return null;
    }
    return providerCircuitBreakers.assertCanRequest(key, {
      label: `${runtime?.descriptor?.providerName ?? "模型服务"} · ${runtime?.descriptor?.modelName ?? runtime?.descriptor?.modelId ?? "模型"}`
    });
  }

  noteProviderSuccess(runtime) {
    const key = providerCircuitKey(runtime);
    if (key) {
      providerCircuitBreakers.recordSuccess(key, {
        label: `${runtime?.descriptor?.providerName ?? "模型服务"} · ${runtime?.descriptor?.modelName ?? runtime?.descriptor?.modelId ?? "模型"}`
      });
    }
  }

  noteProviderFailure(runtime, error) {
    const key = providerCircuitKey(runtime);
    if (key) {
      providerCircuitBreakers.recordFailure(key, error, {
        counted: shouldCountProviderFailure(error),
        label: `${runtime?.descriptor?.providerName ?? "模型服务"} · ${runtime?.descriptor?.modelName ?? runtime?.descriptor?.modelId ?? "模型"}`
      });
    }
  }

  createToolApprovalController(runId, settings, abortSignal) {
    return new ToolApprovalController({
      runId,
      taskId: this.activeRun?.taskId ?? "",
      settings,
      abortSignal,
      onChange: ({ pendingApproval, security }) => {
        if (!this.isCurrentRun(runId)) {
          return;
        }

        this.activeRun.pendingApproval = pendingApproval;
        this.activeRun.toolSecurity = security;

        if (pendingApproval) {
          this.activeRun.activityStore?.upsertEvent({
            id: `approval:${pendingApproval.id}`,
            type: "status",
            status: "attention",
            title: `等待批准：${pendingApproval.title}`,
            category: "tool-approval",
            activityVisibility: "normal",
            createdAt: pendingApproval.requestedAt,
            updatedAt: Date.now()
          });
          openConversationWindow();
        }

        this.persistActiveRunCheckpoint({ status: "running" });
        this.setStatus({ ...this.status }, { immediate: true });
      },
      onResolved: ({ request, decision }) => {
        if (!this.isCurrentRun(runId)) {
          return;
        }
        const allowed = ["allow_once", "allow_run"].includes(decision);
        this.activeRun.activityStore?.upsertEvent({
          id: `approval:${request.id}`,
          type: "status",
          status: allowed ? "completed" : "cancelled",
          title: allowed
            ? `已批准：${request.title}`
            : `已拒绝：${request.title}`,
          category: "tool-approval",
          activityVisibility: "normal",
          createdAt: request.requestedAt,
          updatedAt: Date.now()
        });
        this.persistActiveRunCheckpoint({ status: "running" });
        this.setStatus({ ...this.status }, { immediate: true });
      }
    });
  }

  applyRunState(state) {
    if (!this.activeRun || !state) {
      return state;
    }

    this.activeRun.phase = state.phase;
    this.activeRun.outcome = state.outcome;
    this.activeRun.executionStopReason =
      state.executionStopReason || null;
    this.activeRun.stopReason =
      state.executionStopReason || null;
    this.activeRun.resumable =
      state.resumable === true;
    this.activeRun.publicStatus =
      state.messageStatus;

    return state;
  }

  markRunExecuting() {
    return this.applyRunState(
      this.activeRun
        ?.stateMachine
        ?.markExecuting()
    );
  }

  beginRunFinalization(
    executionStopReason
  ) {
    return this.applyRunState(
      this.activeRun
        ?.stateMachine
        ?.beginFinalization(
          executionStopReason
        )
    );
  }

  requestRunCancellation() {
    return this.applyRunState(
      this.activeRun
        ?.stateMachine
        ?.requestCancellation()
    );
  }

  getRawStatus() {
    const developerMode =
      getSettings().general?.developerMode === true;

    return cloneStatus({
      ...this.status,
      stopReason:
        this.activeRun
          ?.stopReason ??
        this.status.stopReason ??
        null,
      plan:
        this.activeRun
          ?.toolSession
          ?.getPlan?.() ??
        this.activeRun
          ?.initialPlan ?? [],
      activeToolCalls:
        this.activeRun
          ?.toolSession
          ?.getRecords?.() ?? [],
      taskId:
        this.activeRun
          ?.taskId ?? null,
      goalId:
        this.activeRun
          ?.goalId ?? null,
      orchestration:
        this.activeRun
          ?.orchestrator
          ?.snapshot?.() ?? null,
      currentSegmentId:
        this.activeRun?.currentSegmentId ?? "",
      activity:
        this.activeRun
          ?.activityStore
          ?.snapshot?.() ?? null,
      assistantText:
        resolveActiveRunText(
          this.activeRun
        ),
      liveStepText:
        this.activeRun
          ?.currentStepText ?? "",
      liveStepRole:
        this.activeRun
          ?.liveStepRole ?? LIVE_STEP_ROLES.NONE,
      finalText:
        this.activeRun
          ?.finalText ?? "",
      diffSummary:
        this.activeRun
          ?.diffTracker
          ?.snapshot?.() ?? null,
      replaceMessageId:
        this.activeRun
          ?.replaceMessageId ?? "",
      stepNumber:
        this.activeRun
          ?.stepNumber ?? 0,
      phase:
        this.activeRun
          ?.phase ?? "idle",
      outcome:
        this.activeRun
          ?.outcome ??
        this.status.outcome ?? "idle",
      executionStopReason:
        this.activeRun
          ?.executionStopReason ??
        this.status.stopReason ?? null,
      resumable:
        this.activeRun
          ?.resumable ??
        this.status.resumable ?? false,
      publicStatus:
        this.activeRun
          ?.publicStatus ?? "complete",
      finalizationAttemptCount:
        this.activeRun
          ?.finalizationAttemptCount ?? 0,
      contextCompactionCount:
        this.activeRun
          ?.contextCompactionCount ?? 0,
      toolRegistry:
        this.activeRun
          ?.toolSession
          ?.registryManifest ?? [],
      checkpoint:
        this.activeRun
          ?.activityStore
          ?.checkpoint ?? null,
      toolRuntime:
        this.activeRun
          ?.toolSession
          ?.getRuntimeRecovery?.() ?? null,
      pendingApproval:
        this.activeRun
          ?.pendingApproval ?? null,
      toolSecurity:
        this.activeRun
          ?.toolSecurity ?? null,
      skillRun:
        this.activeRun
          ?.skillRun ?? null,
      toolRuntimeDiagnostics:
        developerMode
          ? this.activeRun
              ?.toolSession
              ?.getRuntimeDiagnostics?.() ?? null
          : null,
      providerRuntimeDiagnostics:
        developerMode
          ? getRuntimeCircuitBreakerSnapshot()
          : null
    });
  }

  getStatus() {
    return projectAgentStatus(
      this.getRawStatus(),
      { developerMode: false }
    );
  }

  getSnapshot(target = "generic") {
    return createAgentSnapshotEnvelope(
      projectAgentSnapshot(
        this.getRawStatus(),
        { target }
      ),
      {
        revision: this.statusRevision,
        target
      }
    );
  }

  buildActiveCheckpoint() {
    return agentRunPersistence.buildActiveCheckpoint.call(this);
  }

  ensureActiveAssistantMessage(conversationId) {
    return agentRunPersistence.ensureActiveAssistantMessage.call(
      this,
      conversationId
    );
  }

  persistActiveRunCheckpoint(options = {}) {
    return agentRunPersistence.persistActiveRunCheckpoint.call(
      this,
      options
    );
  }

  finalizeRun(options = {}) {
    return agentRunFinalization.finalizeRun.call(this, options);
  }

  async finishCancelledRun(options) {
    return agentRunFinalization.finishCancelledRun.call(
      this,
      options
    );
  }

  startMessage(content, options = {}) {
    return agentRunPreparation.startMessage.call(
      this,
      content,
      options
    );
  }

  regenerateMessage(options = {}) {
    return agentRunPreparation.regenerateMessage.call(
      this,
      options
    );
  }

  upsertToolRecord(runId, record) {
    return agentRunPersistence.upsertToolRecord.call(
      this,
      runId,
      record
    );
  }

  handleStepEnd(runId, step) {
    return agentRunPersistence.handleStepEnd.call(
      this,
      runId,
      step
    );
  }

  persistAssistantResponse(options) {
    return agentRunPersistence.persistAssistantResponse.call(
      this,
      options
    );
  }

  async withToolRecoverySession(taskId, callback) {
    const normalizedTaskId = String(taskId ?? "").trim();
    if (!normalizedTaskId) {
      return {
        ok: false,
        code: "task-id-required",
        message: "缺少任务标识。"
      };
    }

    if (this.activeRun) {
      if (this.activeRun.taskId === normalizedTaskId) {
        return {
          ok: false,
          code: "run-active",
          message: "任务仍在运行，停止任务后才能处理不确定的工具操作。"
        };
      }
      return {
        ok: false,
        code: "agent-busy",
        message: "当前有其他任务正在运行。"
      };
    }

    const record = conversationManager.getTaskRuntimeRecord(normalizedTaskId);
    if (!record) {
      return {
        ok: false,
        code: "task-not-found",
        message: "找不到该任务的会话与运行上下文。"
      };
    }

    const execution = resolveConversationExecutionContext({
      settings: getSettings(),
      conversation: record.conversation,
      overrides: getRecoveryExecutionOverrides(record.message)
    });
    const settings = execution.settings;
    let activeModel = null;
    try {
      activeModel = resolveActiveModelSettings(settings.model);
    } catch {
      activeModel = null;
    }

    const mcpDefinitions = await mcpClientManager
      .prepareForAgent(settings)
      .catch(() => []);
    const externalDefinitions = [
      ...mcpDefinitions,
      ...declarativeHttpToolManager.getToolDefinitions(settings)
    ];
    const skillRuntime = resolveSkillRuntime({
      registry: skillRegistry,
      skillId: execution.conversation.skillId,
      skillIds: execution.conversation.skillIds ??
        (execution.conversation.skillId ? [execution.conversation.skillId] : []),
      mode: execution.metadata.mode,
      expectedSnapshot: execution.conversation.skillSnapshot,
      expectedSnapshots: execution.conversation.skillSnapshots ??
        (execution.conversation.skillSnapshot ? [execution.conversation.skillSnapshot] : []),
      routingMode: execution.conversation.skillRoutingMode,
      source: execution.conversation.skillSource ?? "manual",
      routerSnapshot: execution.conversation.skillRouter ?? null
    });
    if (!skillRuntime.ok) {
      return skillRuntime;
    }

    const session = createAgentToolSession({
      activeModel,
      settings,
      externalDefinitions,
      resultStoreDirectory: getTaskResultDirectory(normalizedTaskId),
      taskId: normalizedTaskId,
      runId: `recovery-${crypto.randomUUID()}`,
      workspaceId: execution.conversation.workspaceId ?? "",
      mode: execution.metadata.mode,
      segmentId: "recovery",
      capabilityRequest: skillRuntime.capabilityRequest
    });

    try {
      return await callback(session);
    } finally {
      await session.flushPersistence?.().catch(() => false);
      await session.closePersistence?.().catch(() => false);
    }
  }

  async getToolRuntimeRecovery({ taskId } = {}) {
    return this.withToolRecoverySession(taskId, async (session) => ({
      ok: true,
      recovery: projectRuntimeRecovery(
        session.getRuntimeRecovery?.() ?? null
      )
    }));
  }

  getRuntimeRecoveryHistory() {
    if (getSettings().general?.developerMode !== true) {
      return {
        ok: false,
        code: "developer-mode-required",
        message: "恢复中心仅在开发者模式下可用。"
      };
    }

    const storedHistory = conversationManager.listToolRuntimeRecoveryHistory();
    const history = {
      ...storedHistory,
      items: (storedHistory.items ?? []).map((item) => ({
        conversationId: item.conversationId,
        conversationTitle: item.conversationTitle,
        mode: item.mode,
        workspaceId: item.workspaceId,
        workspaceName: item.workspaceName,
        messageId: item.messageId,
        taskId: item.taskId,
        runId: item.runId,
        messageStatus: item.messageStatus,
        stopReason: item.stopReason,
        updatedAt: item.updatedAt,
        recovery: projectRuntimeRecovery(item.recovery)
      }))
    };
    const activeRecovery = projectRuntimeRecovery(
      this.activeRun
      ?.toolSession
      ?.getRuntimeRecovery?.() ?? null
    );

    if (
      !this.activeRun?.taskId ||
      !activeRecovery ||
      (
        Number(activeRecovery.totalCalls ?? 0) === 0 &&
        Number(activeRecovery.unresolvedCount ?? 0) === 0
      )
    ) {
      return { ok: true, history };
    }

    const activeItem = {
      conversationId: this.activeRun.conversationId,
      conversationTitle:
        conversationManager.getConversation(this.activeRun.conversationId)?.title ??
        "当前会话",
      mode: this.activeRun.mode ?? "chat",
      workspaceId: this.activeRun.workspaceId ?? null,
      workspaceName: this.activeRun.activeWorkspace?.name ?? null,
      messageId: this.activeRun.replaceMessageId ?? "live",
      taskId: this.activeRun.taskId,
      runId: this.activeRun.runId,
      messageStatus: "running",
      stopReason: "",
      updatedAt: Date.now(),
      recovery: activeRecovery
    };
    const items = history.items.filter(
      (item) => item.taskId !== activeItem.taskId
    );
    items.unshift(activeItem);

    return {
      ok: true,
      history: {
        ...history,
        taskCount: items.length,
        unresolvedCount: items.reduce(
          (total, item) =>
            total + Number(item.recovery?.unresolvedCount ?? 0),
          0
        ),
        items
      }
    };
  }

  async getDeveloperRunDetails({ taskId, runId } = {}) {
    if (getSettings().general?.developerMode !== true) {
      return {
        ok: false,
        code: "developer-mode-required",
        message: "请先启用开发者模式。"
      };
    }

    const normalizedTaskId = String(taskId ?? "").trim();
    const normalizedRunId = String(runId ?? "").trim();
    if (
      this.activeRun &&
      (
        (!normalizedTaskId && !normalizedRunId) ||
        this.activeRun.taskId === normalizedTaskId ||
        this.activeRun.runId === normalizedRunId
      )
    ) {
      return {
        ok: true,
        source: "active",
        details: {
          ...projectAgentStatus(
            this.getRawStatus(),
            { developerMode: true }
          ),
          id: "live",
          threadRouting: threadRoutingDecisionStore.snapshot({
            conversationId: this.activeRun.conversationId,
            runId: this.activeRun.runId,
            limit: 20
          })
        }
      };
    }

    const record = conversationManager.getTaskRuntimeRecord(normalizedTaskId);
    if (!record) {
      return {
        ok: false,
        code: "task-not-found",
        message: "找不到该任务的运行记录。"
      };
    }

    let runtimeDiagnostics = null;
    if (!this.activeRun) {
      const result = await this.withToolRecoverySession(
        normalizedTaskId,
        async (session) => ({
          ok: true,
          diagnostics: session.getRuntimeDiagnostics?.() ?? null
        })
      );
      if (result?.ok) {
        runtimeDiagnostics = result.diagnostics;
      }
    }

    const message = record.message;
    return {
      ok: true,
      source: "history",
      details: {
        id: message.id,
        state: "historical",
        runId: message.activity?.runId ?? normalizedRunId,
        conversationId: record.conversation.id,
        taskId: normalizedTaskId,
        startedAt: message.activity?.startedAt ?? message.createdAt,
        stopReason: message.stopReason ?? message.activity?.stopReason ?? "",
        plan: message.plan ?? [],
        activeToolCalls: message.toolCalls ?? [],
        activity: message.activity ?? null,
        liveStepText: "",
        liveStepRole: LIVE_STEP_ROLES.NONE,
        finalText: message.content ?? "",
        assistantText: message.content ?? "",
        toolRuntime:
          message.activity?.checkpoint?.toolRuntime ?? null,
        toolRuntimeDiagnostics: runtimeDiagnostics,
        providerRuntimeDiagnostics: getRuntimeCircuitBreakerSnapshot(),
        threadRouting: threadRoutingDecisionStore.snapshot({
          conversationId: record.conversation.id,
          runId: message.activity?.runId ?? normalizedRunId,
          limit: 20
        })
      }
    };
  }

  getCircuitBreakers() {
    if (getSettings().general?.developerMode !== true) {
      return {
        ok: false,
        code: "developer-mode-required",
        message: "请先启用开发者模式。"
      };
    }
    configureRuntimeCircuitBreakers(getSettings());
    return {
      ok: true,
      snapshot: getRuntimeCircuitBreakerSnapshot()
    };
  }

  resetCircuitBreaker(request = {}) {
    if (getSettings().general?.developerMode !== true) {
      return {
        ok: false,
        code: "developer-mode-required",
        message: "请先启用开发者模式。"
      };
    }
    return resetRuntimeCircuitBreaker(request);
  }

  async resolveToolRuntimeRecovery({
    taskId,
    callId,
    action
  } = {}) {
    return this.withToolRecoverySession(taskId, async (session) => {
      const result = await session.resolveRuntimeRecovery?.({
        callId,
        action
      });
      if (result?.recovery) {
        conversationManager.updateToolRuntimeRecovery({
          taskId,
          recovery: result.recovery
        });
      }
      this.setStatus({ ...this.status }, { immediate: true });
      return result
        ? {
            ...result,
            recovery: projectRuntimeRecovery(result.recovery)
          }
        : result;
    });
  }

  resolveToolApproval({ approvalId, decision } = {}) {
    if (!this.activeRun?.approvalController) {
      return {
        ok: false,
        code: "approval-not-active",
        message: "当前没有等待处理的工具批准请求。"
      };
    }

    return this.activeRun.approvalController.resolveApproval({
      approvalId,
      decision
    });
  }

  stop() {
    if (!this.activeRun) {
      return {
        ok: false,
        code: "idle",
        message:
          "当前没有正在生成的回复。"
      };
    }

    this.requestRunCancellation();
    this.activeRun.activityStore
      ?.markStatus(
        "cancelling",
        { title: "正在取消" }
      );
    this.persistActiveRunCheckpoint({
      status: "running"
    });

    this.setStatus({
      ...this.status,
      state: "cancelling"
    });

    this.activeRun
      .abortController
      .abort(
        "user-stop"
      );

    return {
      ok: true,
      runId:
        this.activeRun.runId
    };
  }

  async testConnection(
    modelOverride = {}
  ) {
    const settings =
      getSettings();

    const sanitized =
      sanitizeSettings({
        ...settings,
        model:
          modelOverride &&
          Object.keys(
            modelOverride
          ).length > 0
            ? modelOverride
            : settings.model
      });

    const modelSettings =
      resolveActiveModelSettings(
        sanitized.model
      );

    const startedAt =
      Date.now();
    let runtime = null;

    try {
      runtime =
        createModelRuntime(
          modelSettings
        );
      this.assertProviderAvailable(runtime);

      const result =
        await generateText({
          model: runtime.model,

          system:
            assembleAgentContext({
              settings: sanitized,
              conversation: null,
              memories: []
            }).system,

          prompt:
            "只回复：连接成功",

          ...runtime.requestOptions,
          maxOutputTokens: 16,
          temperature: 0,
          maxRetries: 0,

          timeout: {
            totalMs:
              Math.min(
                modelSettings
                  .timeoutMs,
                30000
              )
          }
        });

      this.noteProviderSuccess(runtime);
      return {
        ok: true,
        latencyMs:
          Date.now() -
          startedAt,
        text:
          result.text.trim()
      };
    } catch (error) {
      this.noteProviderFailure(runtime, error);
      return {
        ok: false,
        latencyMs:
          Date.now() -
          startedAt,
        message:
          formatAgentError(
            error
          )
      };
    }
  }

  async runE2EMessage(options) {
    return agentRunExecution.runE2EMessage.call(this, options);
  }

  async runFinalization(options) {
    return agentRunFinalization.runFinalization.call(this, options);
  }

  async executeAgentSegment(options) {
    return agentRunExecution.executeAgentSegment.call(this, options);
  }

  async runMessage(options) {
    return agentRunExecution.runMessage.call(this, options);
  }

  isCurrentRun(runId) {
    return (
      this.activeRun
        ?.runId === runId
    );
  }

  getSnapshotForWebContents(webContents) {
    const target = projectionTargetForWebContents(webContents);
    const envelope = this.getSnapshot(target);
    if (webContents && !webContents.isDestroyed?.()) {
      this.windowStatusState.set(webContents.id, {
        target,
        revision: envelope.revision,
        status: envelope.status
      });
    }
    return envelope;
  }

  publishStatus() {
    this.statusRevision += 1;
    const revision = this.statusRevision;
    const rawStatus = this.getRawStatus();
    const liveWindowIds = new Set();

    for (
      const window
      of BrowserWindow
        .getAllWindows()
    ) {
      if (
        window.isDestroyed() ||
        window
          .webContents
          .isDestroyed()
      ) {
        continue;
      }

      const webContents = window.webContents;
      const windowId = webContents.id;
      const target = projectionTargetForWebContents(webContents);
      const projected = projectAgentSnapshot(rawStatus, { target });
      const previousState = this.windowStatusState.get(windowId);
      const previous = previousState?.status ?? null;
      const runChanged = String(previous?.runId ?? "") !== String(projected.runId ?? "");
      const targetChanged = previousState?.target !== target;
      const shouldSnapshot = !previous || runChanged || targetChanged;

      liveWindowIds.add(windowId);

      if (shouldSnapshot) {
        const envelope = createAgentSnapshotEnvelope(projected, {
          revision,
          target
        });
        webContents.send(
          IPC_CHANNELS.agent.SNAPSHOT_CHANGED,
          envelope
        );
      } else {
        for (const textEvent of createAgentTextEvents(previous, projected, {
          revision,
          target
        })) {
          webContents.send(
            IPC_CHANNELS.agent.TEXT_CHUNK,
            textEvent
          );
        }

        const patch = createAgentStatusPatch(previous, projected, {
          revision,
          target
        });
        if (patch) {
          webContents.send(
            IPC_CHANNELS.agent.STATUS_PATCH,
            patch
          );
        }
      }

      const lifecycleChanged =
        shouldSnapshot ||
        previous?.state !== projected.state ||
        previous?.outcome !== projected.outcome ||
        previous?.stopReason !== projected.stopReason ||
        previous?.publicStatus !== projected.publicStatus;
      if (lifecycleChanged) {
        /*
         * Keep old preload builds functional without restoring token-by-token
         * full snapshots. Legacy listeners receive only run/lifecycle changes.
         */
        webContents.send(
          IPC_CHANNELS.agent.STATUS_CHANGED,
          projected
        );
      }

      this.windowStatusState.set(windowId, {
        target,
        revision,
        status: projected
      });
    }

    for (const windowId of this.windowStatusState.keys()) {
      if (!liveWindowIds.has(windowId)) {
        this.windowStatusState.delete(windowId);
      }
    }
  }

  setStatus(
    nextStatus,
    { immediate = false } = {}
  ) {
    this.status = {
      ...nextStatus
    };
    this.statusBroadcaster.schedule({ immediate });
  }
}

export const agentRuntime =
  new AgentRuntime();
