import {
  BrowserWindow
} from "electron";

import {
  generateText,
  stepCountIs,
  streamText
} from "ai";

import crypto from "node:crypto";
import path from "node:path";

import IPC_CHANNELS
  from "../shared/ipcChannels.cjs";

import {
  conversationManager,
  getConversationPath
} from "../conversation/index.js";

import {
  platformKernel
} from "../platform/index.js";

import {
  createDelegationToolDefinition
} from "../platform/delegationTools.js";

import {
  getRecoveryExecutionOverrides,
  resolveConversationExecutionContext
} from "../conversation/executionContext.js";

import {
  getSettings
} from "../settings/settingsStore.js";

import {
  memoryManager
} from "../memory/index.js";

import {
  assembleAgentContext
} from "../context/index.js";

import {
  buildCapabilityContext
} from "../context/capabilityContextBuilder.js";

import {
  renderPromptSections
} from "../context/promptSections.js";

import {
  sanitizeSettings
} from "../settings/validateSettings.js";

import {
  resolveActiveModelSettings
} from "../settings/modelSettings.js";

import {
  appendResponseChunk,
  endResponseStream,
  isResponseSender,
  startResponseStream
} from "../windows/response/index.js";

import {
  isConversationSender,
  openConversationWindow
} from "../windows/conversation/conversationWindow.js";

import {
  isInputSender
} from "../windows/input/inputWindow.js";

import {
  createModelRuntime,
  getCredentialError
} from "./modelFactory.js";

import {
  formatAgentError,
  isAbortError
} from "./agentErrors.js";

import {
  getConversationTargetError
} from "./messageTarget.js";

import {
  getE2EToolWriteRequest,
  isE2EMode,
  streamE2EResponse
} from "./e2eAgentDriver.js";

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
  parseSkillCommand,
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
  RunActivityStore
} from "./RunActivityStore.js";

import {
  inferRunStopReason,
  RUN_STOP_REASONS
} from "./runStopReasons.js";

import {
  classifyAgentStep,
  inferLiveStepRole,
  LIVE_STEP_ROLES
} from "./stepText.js";

import {
  compactRunStepContext
} from "./contextCompaction.js";

import {
  createCheckpointInstruction,
  createRunCheckpoint
} from "./runCheckpoint.js";

import {
  createGoalVerificationInstruction
} from "./GoalCompletionVerifier.js";

import {
  createCheckpointContinuationState,
  resolveCheckpointContinuation
} from "./checkpointResume.js";

import {
  createFallbackFinalSummary,
  createFinalizationInstruction,
  sanitizeFinalizationText
} from "./finalization.js";

import {
  LongTaskOrchestrator
} from "./orchestration/LongTaskOrchestrator.js";

import {
  RunStateMachine,
  RUN_OUTCOMES,
  recoveryOutcomeFromSnapshot
} from "./RunStateMachine.js";

import {
  RunEngine
} from "./RunEngine.js";

import {
  createFinalizationBudget
} from "./finalizationBudget.js";

import {
  resolveActiveRunText
} from "./activeRunText.js";

import {
  createAgentStreamTimeout
} from "./agentStreamTimeout.js";

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
  SegmentExecutionLoop
} from "./orchestration/SegmentExecutionLoop.js";





function getActiveCredentialError(modelConfig = null) {
  try {
    const modelSettings =
      resolveActiveModelSettings(
        modelConfig ?? getSettings().model
      );

    return getCredentialError(
      modelSettings
    );
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }
}

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

function appendTaskContinuationToContext(
  context,
  continuation,
  continuationState,
  userInstruction
) {
  if (!continuationState) {
    return context;
  }

  const runtimeInstruction = [
    createCheckpointInstruction(
      continuation?.checkpoint
    ),
    [
      "[Continued task]",
      "Continue the same task using the saved task state above.",
      "Keep completed plan steps and prior tool results. Do not repeat completed work unless verification is necessary.",
      `The user's latest instruction is: ${String(userInstruction ?? "").trim()}`,
      "Treat that instruction as guidance for the remaining work. Replan only when it materially changes the unfinished steps.",
      "Do not tell the user about internal execution slices, counters, budgets, limits, saved-state mechanics, or runtime stop reasons."
    ].join("\n")
  ].filter(Boolean).join("\n\n");

  context.runtimeInstructions = [
    context.runtimeInstructions,
    runtimeInstruction
  ].filter(Boolean).join("\n\n");
  context.system = [
    context.system,
    runtimeInstruction
  ].filter(Boolean).join("\n\n");

  context.metadata = {
    ...context.metadata,
    continuedTask: true,
    taskId: continuationState.taskId,
    parentRunId: continuationState.parentRunId,
    resumedFromMessageId:
      continuationState.resumedFromMessageId,
    continuationCount:
      continuationState.continuationCount
  };

  return context;
}


function getTaskResultDirectory(taskId) {
  const safeTaskId = String(taskId ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);

  if (!safeTaskId) {
    return "";
  }

  try {
    return path.join(
      path.dirname(getConversationPath()),
      "tool-results",
      safeTaskId
    );
  } catch {
    return "";
  }
}

async function settleResultValue(
  value,
  fallback
) {
  try {
    return await value;
  } catch {
    return fallback;
  }
}

function createRunStateFields(startedAt) {
  const stateMachine = new RunStateMachine({
    startedAt
  });
  const state = stateMachine.snapshot();

  return {
    stateMachine,
    phase: state.phase,
    outcome: state.outcome,
    executionStopReason: state.executionStopReason || null,
    stopReason: state.executionStopReason || null,
    resumable: state.resumable,
    publicStatus: state.messageStatus
  };
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
    if (!this.activeRun) {
      return null;
    }

    const runtimeCursor = this.activeRun.toolSession
      ?.getRuntimeCursor?.() ?? {};

    return createRunCheckpoint({
      taskId: this.activeRun.taskId,
      workspaceId:
        this.activeRun.workspaceId ?? "",
      workspaceSnapshot:
        this.activeRun.workspaceSnapshot ?? null,
      mode: this.activeRun.mode ?? "chat",
      modelSelection:
        this.activeRun.modelSelection ?? null,
      modelSnapshot:
        this.activeRun.modelSnapshot ?? null,
      skillId:
        this.activeRun.skillRuntime?.skill?.id ?? "",
      skillSnapshot:
        this.activeRun.skillRuntime?.skill ?? null,
      skillIds:
        this.activeRun.skillRuntime?.rootSkillIds ?? [],
      skillSnapshots:
        this.activeRun.skillRuntime?.skills ?? [],
      skillRoutingMode:
        this.activeRun.skillRuntime?.routingMode ?? "manual",
      skillSource:
        this.activeRun.skillRuntime?.source ?? "manual",
      skillRouter:
        this.activeRun.skillRuntime?.router ?? null,
      goalId: this.activeRun.goalId,
      runId: this.activeRun.runId,
      parentRunId:
        this.activeRun.parentRunId ?? "",
      messageId:
        this.activeRun.replaceMessageId ?? "",
      resumedFromMessageId:
        this.activeRun.resumedFromMessageId ?? "",
      objective:
        this.activeRun.objective ?? "",
      phase:
        this.activeRun.phase ?? "executing",
      outcome:
        this.activeRun.outcome ?? "running",
      resumable:
        this.activeRun.resumable === true,
      publicStatus:
        this.activeRun.publicStatus ?? "running",
      plan:
        this.activeRun.toolSession
          ?.getPlan?.() ??
        this.activeRun.initialPlan ?? [],
      planState:
        this.activeRun.toolSession
          ?.getPlanState?.() ??
        this.activeRun.initialPlanState ??
        this.activeRun.initialPlan ?? [],
      records:
        this.activeRun.toolSession
          ?.getRecords?.() ??
        this.activeRun.toolCalls ?? [],
      stopReason:
        this.activeRun.stopReason ?? "",
      contextCompactions:
        this.activeRun.contextCompactionCount ?? 0,
      continuationCount:
        this.activeRun.continuationCount ?? 0,
      previousSegmentCount:
        this.activeRun.previousSegmentCount ?? 0,
      orchestration:
        this.activeRun.orchestrator
          ?.snapshot?.({ compact: true }) ?? null,
      toolRuntime:
        this.activeRun.toolSession
          ?.getRuntimeRecovery?.() ?? null,
      ...runtimeCursor
    });
  }

  ensureActiveAssistantMessage(
    conversationId
  ) {
    if (!this.activeRun) {
      return null;
    }

    if (this.activeRun.replaceMessageId) {
      this.persistActiveRunCheckpoint({
        status: "running"
      });
      return this.activeRun.replaceMessageId;
    }

    const checkpoint =
      this.buildActiveCheckpoint();
    this.activeRun.activityStore
      ?.updateCheckpoint(checkpoint);

    const persisted =
      this.persistAssistantResponse({
        conversationId,
        content: "",
        status: "running"
      });
    const message =
      persisted?.message ?? persisted;

    if (message?.id) {
      this.activeRun.replaceMessageId =
        message.id;
      this.activeRun.resumeInPlace = true;

      const updated =
        this.buildActiveCheckpoint();
      this.activeRun.activityStore
        ?.updateCheckpoint(updated);
      this.persistAssistantResponse({
        conversationId,
        content: "",
        status: "running"
      });
    }

    return this.activeRun.replaceMessageId;
  }

  persistActiveRunCheckpoint({
    status = "running"
  } = {}) {
    if (
      !this.activeRun ||
      !this.activeRun.replaceMessageId
    ) {
      return null;
    }

    const checkpoint =
      this.buildActiveCheckpoint();
    this.activeRun.activityStore
      ?.updateCheckpoint(checkpoint);

    return this.persistAssistantResponse({
      conversationId:
        this.activeRun.conversationId,
      content:
        resolveActiveRunText(
          this.activeRun
        ),
      status
    });
  }

  finalizeRun({
    runId,
    conversationId,
    executionStopReason,
    outcome,
    content = "",
    lastError = "",
    closeResponse = true
  } = {}) {
    if (!this.isCurrentRun(runId)) {
      return null;
    }

    const run = this.activeRun;
    const runtimeRecovery = run.toolSession
      ?.getRuntimeRecovery?.() ?? null;
    const recoveryOutcome = recoveryOutcomeFromSnapshot(
      runtimeRecovery
    );
    const effectiveOutcome = recoveryOutcome || outcome;
    const effectiveStopReason = recoveryOutcome
      ? RUN_STOP_REASONS.INTERRUPTED
      : executionStopReason;

    if (run.platformRunId) {
      const platformStatus = effectiveOutcome === RUN_OUTCOMES.CANCELLED
        ? "cancelled"
        : effectiveOutcome === RUN_OUTCOMES.FAILED
          ? "failed"
          : effectiveOutcome === RUN_OUTCOMES.COMPLETED
            ? "completed"
            : "interrupted";
      const platformTaskStatus = platformStatus === "completed"
        ? "continuable"
        : platformStatus === "interrupted"
          ? "continuable"
          : platformStatus;
      platformKernel.finishAgentRun(
        run.platformRunId,
        run.runId,
        {
          status: platformStatus,
          outcome: effectiveOutcome,
          stopReason: effectiveStopReason,
          error: lastError,
          taskStatus: platformTaskStatus
        }
      );
      const currentPlatformRun = platformKernel.getRun(run.platformRunId);
      if (currentPlatformRun && currentPlatformRun.status !== "completed") {
        platformKernel.setRunStatus(
          run.platformRunId,
          platformStatus === "cancelled"
            ? "cancelled"
            : platformStatus === "failed"
              ? "failed"
              : "continuable",
          effectiveStopReason
        );
      }
    }
    const state = this.applyRunState(
      run.stateMachine.finalize({
        executionStopReason: effectiveStopReason,
        outcome: effectiveOutcome,
        lastError
      })
    );

    const orchestration =
      run.orchestrator?.snapshot?.();
    if (
      orchestration?.task?.status === "running" &&
      state.outcome !== RUN_OUTCOMES.COMPLETED
    ) {
      run.orchestrator.terminate(
        state.executionStopReason
      );
    }

    run.finalText = String(content ?? "").trim();
    if (run.skillRun) {
      const skillStatus = state.outcome === RUN_OUTCOMES.COMPLETED
        ? "completed"
        : state.outcome === RUN_OUTCOMES.CANCELLED
          ? "cancelled"
          : state.outcome === RUN_OUTCOMES.FAILED
            ? "failed"
            : "interrupted";
      run.skillRun = {
        ...run.skillRun,
        status: skillStatus,
        endedAt: state.endedAt
      };
      run.activityStore?.recordSkill({
        skill: run.skillRuntime.skill,
        skills: run.skillRuntime.skills,
        source: run.skillRuntime.source,
        router: run.skillRuntime.router,
        status: skillStatus,
        selectedToolNames: run.skillRun.selectedToolNames,
        missingRequired: run.skillRun.missingRequired
      }, state.endedAt);
    }
    run.activityStore?.finalize(
      state.executionStopReason,
      state.endedAt,
      {
        status: state.activityStatus,
        outcome: state.outcome,
        resumable: state.resumable
      }
    );
    const finalCheckpoint = this.buildActiveCheckpoint();
    run.activityStore?.updateCheckpoint(
      finalCheckpoint
    );
    if (run.persistentGoalId) {
      if (finalCheckpoint) {
        conversationManager.recordGoalCheckpoint({
          conversationId,
          goalId: run.persistentGoalId,
          checkpoint: finalCheckpoint
        });
      }
      conversationManager.finishGoalRun({
        conversationId,
        goalId: run.persistentGoalId,
        runId,
        outcome: state.outcome,
        stopReason: state.executionStopReason,
        error: state.lastError
      });
    }

    this.persistAssistantResponse({
      conversationId,
      content: run.finalText,
      status: state.messageStatus
    });
    run.approvalController?.close?.();
    const closePersistence =
      run.toolSession
        ?.closePersistence?.();

    if (closePersistence) {
      void Promise.resolve(
        closePersistence
      )
        .then((closed) => {
          if (closed === false) {
            console.warn(
              "工具事件持久化仍有待写入数据，将在应用退出前重试。"
            );
          }
        })
        .catch((error) => {
          console.warn(
            "关闭工具事件持久化失败：",
            error
          );
        });
    }

    /*
     * Response 窗口需要在 activeRun 被释放前收到最后一份结构化快照。
     * 否则错误兜底或本地总结只存在于旧的文本流中，工具活动与最终回复
     * 无法分区渲染。
     */
    this.setStatus({
      state: state.runtimeState,
      runId,
      conversationId,
      startedAt: run.startedAt,
      lastError: state.lastError || null,
      stopReason: state.executionStopReason,
      outcome: state.outcome,
      resumable: state.resumable
    }, { immediate: true });

    if (closeResponse) {
      endResponseStream();
    }

    const finalState = {
      ...state
    };
    this.activeRun = null;

    this.setStatus({
      state: state.runtimeState,
      runId: null,
      conversationId,
      startedAt: null,
      lastError: state.lastError || null,
      stopReason: state.executionStopReason,
      outcome: state.outcome,
      resumable: state.resumable
    }, { immediate: true });

    return finalState;
  }

  async finishCancelledRun({
    runId,
    conversationId
  }) {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    const savePartial =
      this.activeRun.runtimePreferences
        ?.saveAbortedReplies !== false;
    const partialContent = savePartial
      ? resolveActiveRunText(
          this.activeRun,
          { trim: true }
        )
      : "";
    const runtimeRecovery = this.activeRun
      .toolSession
      ?.getRuntimeRecovery?.();
    const hasUncertainEffects =
      Number(runtimeRecovery?.unresolvedCount) > 0;
    const recoveryNotice = hasUncertainEffects
      ? "已停止继续执行，但有工具操作的最终状态尚未确认。请先核验或确认这些操作，再继续任务。"
      : "";
    const content = [
      partialContent,
      recoveryNotice
    ].filter(Boolean).join("\n\n");

    const checkpoint = this.buildActiveCheckpoint();
    if (checkpoint) {
      await this.activeRun.toolSession
        ?.storeRuntimeCheckpoint?.(checkpoint, {
          runId,
          segmentId: this.activeRun.currentSegmentId
        });
    }
    await this.activeRun.toolSession
      ?.recordRuntimeEvent?.(
        hasUncertainEffects ? "RUN_INTERRUPTED" : "RUN_CANCELLED",
        {
          outcome: hasUncertainEffects ? "interrupted" : "cancelled",
          unresolvedTools: runtimeRecovery?.unresolvedCount ?? 0
        },
        { runId }
      );

    this.finalizeRun({
      runId,
      conversationId,
      executionStopReason: hasUncertainEffects
        ? RUN_STOP_REASONS.INTERRUPTED
        : RUN_STOP_REASONS.CANCELLED_BY_USER,
      outcome: hasUncertainEffects
        ? recoveryOutcomeFromSnapshot(runtimeRecovery) || RUN_OUTCOMES.UNKNOWN
        : RUN_OUTCOMES.CANCELLED,
      content
    });
  }

  startMessage(
    content,
    {
      expectedConversationId = "",
      continueTask = false
    } = {}
  ) {
    const message =
      String(content ?? "")
        .trim();

    if (!message) {
      return {
        ok: false,
        code: "empty-message",
        message:
          "消息不能为空。"
      };
    }

    if (this.activeRun) {
      return {
        ok: false,
        code: "busy",
        message:
          "当前回复尚未结束，请先停止生成。"
      };
    }

    const credentialConversation =
      conversationManager.getCurrentConversation();
    const initialTargetError =
      getConversationTargetError(
        credentialConversation,
        expectedConversationId
      );

    if (initialTargetError) {
      return initialTargetError;
    }

    const credentialBinding =
      resolveConversationExecutionContext({
        settings: getSettings(),
        conversation: credentialConversation
      });
    const credentialError =
      isE2EMode()
        ? null
        : getActiveCredentialError(
            credentialBinding.settings.model
          );

    if (credentialError) {
      const errorMessage =
        credentialError;

      startResponseStream();
      appendResponseChunk(
        `⚠ ${errorMessage}`
      );
      endResponseStream();

      this.setStatus({
        state: "error",
        runId: null,
        conversationId: null,
        startedAt: null,
        lastError:
          errorMessage
      });

      return {
        ok: false,
        code: "missing-api-key",
        message: errorMessage
      };
    }

    let conversation;
    let memories;
    let context;
    let runSettings;
    let activeWorkspace = null;
    let executionConversation;
    let skillRuntime = null;
    let checkpointContinuation = null;
    let continuationState = null;
    let runMessage = message;
    let skillCommand = null;

    try {
      conversation =
        conversationManager
          .getCurrentConversation();

      const targetError =
        getConversationTargetError(
          conversation,
          expectedConversationId
        );

      if (targetError) {
        return targetError;
      }

      checkpointContinuation =
        resolveCheckpointContinuation({
          conversation,
          message,
          explicit: continueTask === true
        });
      continuationState =
        createCheckpointContinuationState(
          checkpointContinuation
        );

      if (!continuationState) {
        const runtimeSkills = skillRegistry.getRuntimeState({ mode: conversation.mode }).skills;
        skillCommand = parseSkillCommand(
          message,
          runtimeSkills.map((skill) => skill.id)
        );
        if (skillCommand.matched && skillCommand.ok === false) {
          return skillCommand;
        }
        if (skillCommand.matched) {
          runMessage = skillCommand.content;
        }
      }

      const settingsSnapshot = getSettings();
      const preparedExecution =
        resolveConversationExecutionContext({
          settings: settingsSnapshot,
          conversation,
          overrides: continuationState ?? {}
        });
      const boundSkillIds = preparedExecution.conversation.skillIds ??
        (preparedExecution.conversation.skillId ? [preparedExecution.conversation.skillId] : []);
      skillRuntime = resolveSkillRuntime({
        registry: skillRegistry,
        skillId: preparedExecution.conversation.skillId,
        skillIds: skillCommand?.matched ? skillCommand.skillIds : boundSkillIds,
        mode: preparedExecution.metadata.mode,
        expectedSnapshot: preparedExecution.conversation.skillSnapshot,
        expectedSnapshots: skillCommand?.matched
          ? null
          : preparedExecution.conversation.skillSnapshots ??
            (preparedExecution.conversation.skillSnapshot ? [preparedExecution.conversation.skillSnapshot] : []),
        routingMode: skillCommand?.matched
          ? "manual"
          : preparedExecution.conversation.skillRoutingMode,
        routeMessage: runMessage,
        source: skillCommand?.matched
          ? "command"
          : continuationState
            ? preparedExecution.conversation.skillSource ?? "manual"
            : "manual",
        routerSnapshot: skillCommand?.matched
          ? null
          : continuationState
            ? preparedExecution.conversation.skillRouter ?? null
            : null
      });
      if (!skillRuntime.ok) {
        return skillRuntime;
      }

      conversationManager
        .appendMessage({
          conversationId:
            conversation.id,
          role: "user",
          content: runMessage
        });

      conversation =
        conversationManager
          .getConversation(
            conversation.id
          );

      memories =
        memoryManager.retrieve({
          query: runMessage
        });

      const execution =
        resolveConversationExecutionContext({
          settings: settingsSnapshot,
          conversation,
          overrides: continuationState ?? {}
        });
      executionConversation = execution.conversation;
      runSettings = execution.settings;
      activeWorkspace = execution.workspace;

      context =
        assembleAgentContext({
          settings: runSettings,
          conversation:
            executionConversation,
          memories,
          skillRuntime
        });

      context = appendTaskContinuationToContext(
        context,
        checkpointContinuation,
        continuationState,
        runMessage
      );

    } catch (error) {
      const errorMessage =
        "无法准备当前消息或长期记忆，请检查应用数据目录。";

      console.error(
        "准备会话消息或长期记忆失败：",
        error
      );

      startResponseStream();
      appendResponseChunk(
        `⚠ ${errorMessage}`
      );
      endResponseStream();

      return {
        ok: false,
        code:
          "conversation-write-failed",
        message: errorMessage
      };
    }

    const runId =
      crypto.randomUUID();

    const persistentGoal =
      executionConversation.goal?.status === "active"
        ? executionConversation.goal
        : null;

    const goalId =
      continuationState?.goalId ||
      persistentGoal?.id ||
      crypto.randomUUID();

    const taskId =
      continuationState?.taskId ||
      crypto.randomUUID();

    const abortController =
      new AbortController();

    const startedAt =
      Date.now();

    const activityStore =
      new RunActivityStore({
        taskId,
        runId,
        startedAt
      });

    this.activeRun = {
      runId,
      goalId,
      parentRunId:
        continuationState?.parentRunId ?? "",
      objective:
        continuationState?.objective ||
        persistentGoal?.objective ||
        runMessage,
      persistentGoalId:
        persistentGoal?.id ?? "",
      goalSpec: persistentGoal ? structuredClone(persistentGoal) : null,
      continuationInstruction:
        continuationState ? runMessage : "",
      continuationCount:
        continuationState?.continuationCount ?? 0,
      previousSegmentCount:
        continuationState?.previousSegmentCount ?? 0,
      orchestrator: null,
      currentSegmentId: "",
      taskId,
      workspaceId:
        executionConversation.workspaceId ?? null,
      workspaceSnapshot:
        executionConversation.workspaceSnapshot ?? null,
      mode:
        executionConversation.mode ?? "chat",
      modelSelection:
        executionConversation.modelSelection ?? null,
      modelSnapshot:
        executionConversation.modelSnapshot ?? null,
      skillRuntime,
      skillRun: skillRuntime.active
        ? {
            id: skillRuntime.skill.id,
            name: skillRuntime.rootSkills.map((skill) => skill.name).join(" + "),
            version: skillRuntime.skill.version,
            status: "running",
            source: skillRuntime.source,
            routingMode: skillRuntime.routingMode,
            skills: structuredClone(skillRuntime.skills),
            rootSkillIds: [...skillRuntime.rootSkillIds],
            dependencySkillIds: skillRuntime.dependencySkills.map((skill) => skill.id),
            router: skillRuntime.router ? structuredClone(skillRuntime.router) : null,
            requiredCapabilities: [...skillRuntime.capabilityRequest.requiredCapabilities],
            optionalCapabilities: [...skillRuntime.capabilityRequest.optionalCapabilities],
            selectedToolNames: [],
            missingRequired: [],
            startedAt,
            endedAt: null
          }
        : null,
      activeWorkspace,
      runtimePreferences: {
        saveAbortedReplies:
          runSettings.conversation?.saveAbortedReplies !== false,
        saveToolHistory:
          runSettings.tools?.runtime?.saveToolHistory !== false
      },
      conversationId:
        conversation.id,
      abortController,
      currentStepText: "",
      liveStepRole: LIVE_STEP_ROLES.NONE,
      finalText: "",
      stepNumber: 0,
      startedAt,
      replaceMessageId: null,
      toolCalls: [],
      pendingApproval: null,
      toolSecurity: null,
      approvalController: null,
      activityStore,
      initialPlan:
        continuationState?.initialPlan ?? [],
      initialPlanState:
        continuationState?.initialPlanState ??
        continuationState?.initialPlan ?? [],
      resumedFromMessageId:
        continuationState?.resumedFromMessageId ?? "",
      platformRunId: "",
      platformLeaseIds: [],
      platformError: null,
      resumeInPlace: false,
      finalizationAttemptCount: 0,
      contextCompactionCount:
        continuationState?.contextCompactionCount ?? 0,
      ...createRunStateFields(startedAt)
    };

    if (persistentGoal) {
      try {
        const platformExecution = platformKernel.prepareExecution({
          conversationId: conversation.id,
          goal: persistentGoal,
          agentRunId: runId,
          taskId,
          workspaceId: executionConversation.workspaceId ?? null,
          workspaceResource: activeWorkspace
            ? `workspace:${activeWorkspace.canonicalPath ?? activeWorkspace.rootPath ?? activeWorkspace.id}`
            : "",
          mode: executionConversation.mode ?? "chat"
        });
        if (platformExecution.ok) {
          this.activeRun.platformRunId = platformExecution.platformRunId;
          this.activeRun.platformLeaseIds = platformExecution.leaseIds;
        } else {
          this.activeRun.platformError = platformExecution;
        }
      } catch (error) {
        this.activeRun.platformError = {
          ok: false,
          code: "platform-kernel-start-failed",
          message: String(error?.message ?? error)
        };
      }

      const startedGoal = conversationManager.beginGoalRun({
        conversationId: conversation.id,
        goalId: persistentGoal.id,
        runId,
        taskId,
        platformRunId: this.activeRun.platformRunId || undefined
      });
      if (!startedGoal.ok && !this.activeRun.platformError) {
        this.activeRun.platformError = startedGoal;
      }
    }

    if (skillRuntime.active) {
      activityStore.recordSkill({
        skill: skillRuntime.skill,
        skills: skillRuntime.skills,
        source: skillRuntime.source,
        router: skillRuntime.router,
        status: "running"
      });
    }

    this.ensureActiveAssistantMessage(
      conversation.id
    );

    this.setStatus({
      state: "running",
      runId,
      conversationId:
        conversation.id,
      startedAt,
      lastError: null
    });

    const runArguments = {
      runId,
      conversationId:
        conversation.id,
      context,
      memories,
      settings: runSettings,
      abortController
    };

    if (isE2EMode()) {
      void this.runE2EMessage(
        runArguments
      );
    } else {
      void this.runMessage(
        runArguments
      );
    }

    return {
      ok: true,
      runId,
      taskId,
      conversationId:
        conversation.id,
      continuedTask:
        Boolean(continuationState),
      resumedFromMessageId:
        continuationState?.resumedFromMessageId ?? ""
    };
  }

  regenerateMessage({
    conversationId,
    messageId
  } = {}) {
    if (this.activeRun) {
      return {
        ok: false,
        code: "busy",
        message:
          "当前回复尚未结束，请先停止生成。"
      };
    }

    const credentialError =
      isE2EMode()
        ? null
        : getActiveCredentialError();

    if (credentialError) {
      return {
        ok: false,
        code: "missing-api-key",
        message: credentialError
      };
    }

    let plan;
    let memories;
    let context;
    let runSettings;
    let activeWorkspace = null;
    let skillRuntime = null;

    try {
      plan =
        conversationManager
          .prepareRegeneration({
            conversationId:
              String(
                conversationId ?? ""
              ),
            messageId:
              String(
                messageId ?? ""
              )
          });

      if (!plan.ok) {
        return plan;
      }

      const previousSkillRun = plan.targetMessage?.skillRun ?? null;
      const regenerationSkillIds = previousSkillRun?.rootSkillIds?.length
        ? previousSkillRun.rootSkillIds
        : plan.conversation.skillIds ??
          (plan.conversation.skillId ? [plan.conversation.skillId] : []);
      const regenerationSkillSnapshots = previousSkillRun?.skills?.length
        ? previousSkillRun.skills
        : plan.conversation.skillSnapshots ??
          (plan.conversation.skillSnapshot ? [plan.conversation.skillSnapshot] : []);

      skillRuntime = resolveSkillRuntime({
        registry: skillRegistry,
        skillId: previousSkillRun?.id ?? plan.conversation.skillId,
        skillIds: regenerationSkillIds,
        mode: plan.conversation.mode,
        expectedSnapshot: plan.conversation.skillSnapshot,
        expectedSnapshots: regenerationSkillSnapshots,
        routingMode: previousSkillRun?.routingMode ?? plan.conversation.skillRoutingMode,
        routeMessage: plan.userMessage.content,
        source: previousSkillRun?.source ?? "manual",
        routerSnapshot: previousSkillRun?.router ?? null
      });
      if (!skillRuntime.ok) {
        return skillRuntime;
      }

      memories =
        memoryManager.retrieve({
          query:
            plan.userMessage
              .content
        });

      const execution =
        resolveConversationExecutionContext({
          settings: getSettings(),
          conversation: plan.conversation
        });
      runSettings = execution.settings;
      activeWorkspace = execution.workspace;

      context =
        assembleAgentContext({
          settings: runSettings,
          conversation:
            plan.conversation,
          memories,
          skillRuntime
        });

      context.metadata = {
        ...context.metadata,
        regeneration: true
      };
    } catch (error) {
      console.error(
        "准备重新生成失败：",
        error
      );

      return {
        ok: false,
        code:
          "regeneration-prepare-failed",
        message:
          "无法准备重新生成。"
      };
    }

    const runId =
      crypto.randomUUID();

    const persistentGoal =
      plan.conversation.goal?.status === "active"
        ? plan.conversation.goal
        : null;

    const goalId =
      persistentGoal?.id ||
      crypto.randomUUID();

    const taskId =
      crypto.randomUUID();


    const abortController =
      new AbortController();

    const startedAt =
      Date.now();

    const activityStore =
      new RunActivityStore({
        taskId,
        runId,
        startedAt
      });

    this.activeRun = {
      runId,
      goalId,
      objective:
        persistentGoal?.objective ||
        plan.userMessage.content,
      persistentGoalId:
        persistentGoal?.id ?? "",
      goalSpec: persistentGoal ? structuredClone(persistentGoal) : null,
      orchestrator: null,
      currentSegmentId: "",
      taskId,
      workspaceId:
        plan.conversation.workspaceId ?? null,
      workspaceSnapshot:
        plan.conversation.workspaceSnapshot ?? null,
      mode: plan.conversation.mode ?? "chat",
      modelSelection:
        plan.conversation.modelSelection ?? null,
      modelSnapshot:
        plan.conversation.modelSnapshot ?? null,
      skillRuntime,
      skillRun: skillRuntime.active
        ? {
            id: skillRuntime.skill.id,
            name: skillRuntime.rootSkills.map((skill) => skill.name).join(" + "),
            version: skillRuntime.skill.version,
            status: "running",
            source: skillRuntime.source,
            routingMode: skillRuntime.routingMode,
            skills: structuredClone(skillRuntime.skills),
            rootSkillIds: [...skillRuntime.rootSkillIds],
            dependencySkillIds: skillRuntime.dependencySkills.map((skill) => skill.id),
            router: skillRuntime.router ? structuredClone(skillRuntime.router) : null,
            requiredCapabilities: [...skillRuntime.capabilityRequest.requiredCapabilities],
            optionalCapabilities: [...skillRuntime.capabilityRequest.optionalCapabilities],
            selectedToolNames: [],
            missingRequired: [],
            startedAt,
            endedAt: null
          }
        : null,
      activeWorkspace,
      runtimePreferences: {
        saveAbortedReplies:
          runSettings.conversation?.saveAbortedReplies !== false,
        saveToolHistory:
          runSettings.tools?.runtime?.saveToolHistory !== false
      },
      conversationId:
        plan.conversation.id,
      abortController,
      currentStepText: "",
      liveStepRole: LIVE_STEP_ROLES.NONE,
      finalText: "",
      stepNumber: 0,
      startedAt,
      replaceMessageId:
        plan.targetMessage.id,
      toolCalls: [],
      pendingApproval: null,
      toolSecurity: null,
      approvalController: null,
      activityStore,
      initialPlan: [],
      initialPlanState: [],
      resumedFromMessageId: "",
      platformRunId: "",
      platformLeaseIds: [],
      platformError: null,
      resumeInPlace: false,
      finalizationAttemptCount: 0,
      contextCompactionCount: 0,
      ...createRunStateFields(startedAt)
    };

    if (persistentGoal) {
      try {
        const platformExecution = platformKernel.prepareExecution({
          conversationId: plan.conversation.id,
          goal: persistentGoal,
          agentRunId: runId,
          taskId,
          workspaceId: plan.conversation.workspaceId ?? null,
          workspaceResource: activeWorkspace
            ? `workspace:${activeWorkspace.canonicalPath ?? activeWorkspace.rootPath ?? activeWorkspace.id}`
            : "",
          mode: plan.conversation.mode ?? "chat"
        });
        if (platformExecution.ok) {
          this.activeRun.platformRunId = platformExecution.platformRunId;
          this.activeRun.platformLeaseIds = platformExecution.leaseIds;
        } else {
          this.activeRun.platformError = platformExecution;
        }
      } catch (error) {
        this.activeRun.platformError = {
          ok: false,
          code: "platform-kernel-start-failed",
          message: String(error?.message ?? error)
        };
      }

      const startedGoal = conversationManager.beginGoalRun({
        conversationId: plan.conversation.id,
        goalId: persistentGoal.id,
        runId,
        taskId,
        platformRunId: this.activeRun.platformRunId || undefined
      });
      if (!startedGoal.ok && !this.activeRun.platformError) {
        this.activeRun.platformError = startedGoal;
      }
    }

    if (skillRuntime.active) {
      activityStore.recordSkill({
        skill: skillRuntime.skill,
        skills: skillRuntime.skills,
        source: skillRuntime.source,
        router: skillRuntime.router,
        status: "running"
      });
    }

    this.ensureActiveAssistantMessage(
      plan.conversation.id
    );

    this.setStatus({
      state: "running",
      runId,
      conversationId:
        plan.conversation.id,
      startedAt,
      lastError: null
    });

    const runArguments = {
      runId,
      conversationId:
        plan.conversation.id,
      context,
      memories,
      settings: runSettings,
      abortController
    };

    if (isE2EMode()) {
      void this.runE2EMessage(
        runArguments
      );
    } else {
      void this.runMessage(
        runArguments
      );
    }

    return {
      ok: true,
      runId,
      conversationId:
        plan.conversation.id,
      messageId:
        plan.targetMessage.id
    };
  }

  upsertToolRecord(
    runId,
    record
  ) {
    if (
      !this.isCurrentRun(runId)
    ) {
      return;
    }

    const records =
      this.activeRun.toolCalls;

    const index =
      records.findIndex(
        (item) =>
          item.id === record.id
      );

    if (index >= 0) {
      records[index] = {
        ...records[index],
        ...structuredClone(record)
      };
    } else {
      records.push(
        structuredClone(record)
      );
    }

    this.activeRun
      .activityStore
      ?.upsertTool(record);

    if (
      [
        "retrying",
        "completed",
        "failed",
        "cancelled"
      ].includes(record.status)
    ) {
      this.persistActiveRunCheckpoint({
        status: "running"
      });
    }

    this.setStatus({
      ...this.status
    });
  }

  handleStepEnd(
    runId,
    step
  ) {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    const classified =
      classifyAgentStep(step);

    this.activeRun.stepNumber =
      Number(step?.stepNumber) || 0;

    this.activeRun.orchestrator
      ?.recordStep(step);

    if (
      classified.kind ===
        "commentary"
    ) {
      this.activeRun
        .activityStore
        ?.recordCommentary({
          content:
            classified.text,
          phase:
            classified.phase,
          objective:
            classified.objective
        });
    } else if (
      classified.kind ===
        "final"
    ) {
      this.activeRun
        .activityStore
        ?.closeBatch(
          "completed"
        );
      this.activeRun.finalText =
        classified.text;
    }

    void this.activeRun.toolSession?.recordRuntimeEvent?.(
      "MODEL_STEP_COMPLETED",
      {
        stepNumber: this.activeRun.stepNumber,
        kind: classified.kind,
        hasToolCalls: classified.kind === "commentary"
      },
      {
        runId,
        segmentId: this.activeRun.currentSegmentId
      }
    );

    this.activeRun.currentStepText =
      "";
    this.activeRun.liveStepRole =
      LIVE_STEP_ROLES.NONE;
    this.activeRun.toolSession?.endStep?.(
      `${this.activeRun.currentSegmentId}:step:${this.activeRun.stepNumber}`
    );

    this.persistActiveRunCheckpoint({
      status: "running"
    });

    this.setStatus({
      ...this.status
    });
  }

  persistAssistantResponse({
    conversationId,
    content,
    status = "complete"
  }) {
    if (!this.activeRun) {
      return null;
    }

    const saveToolHistory =
      this.activeRun.runtimePreferences
        ?.saveToolHistory !== false;
    const activitySnapshot =
      this.activeRun
        .activityStore
        ?.snapshot?.() ?? null;
    const persistedActivity =
      !saveToolHistory &&
      activitySnapshot
        ? {
            ...activitySnapshot,
            events:
              activitySnapshot.events
                .filter(
                  (event) =>
                    event.type !==
                    "tool"
                )
          }
        : activitySnapshot;

    const metadata = {
      durationMs:
        Math.max(
          1,
          Date.now() -
          this.activeRun.startedAt
        ),
      toolCalls:
        saveToolHistory
          ? this.activeRun
              .toolCalls
          : [],
      plan:
        this.activeRun
          .toolSession
          ?.getPlan?.() ??
        this.activeRun
          .initialPlan ?? [],
      planState:
        this.activeRun
          .toolSession
          ?.getPlanState?.() ??
        this.activeRun
          .initialPlanState ??
        this.activeRun
          .initialPlan ?? [],
      stopReason:
        this.activeRun.executionStopReason ??
        (status === "aborted"
          ? RUN_STOP_REASONS.CANCELLED_BY_USER
          : status === "running"
            ? ""
            : RUN_STOP_REASONS.COMPLETED),
      resumedFromMessageId:
        this.activeRun
          .resumedFromMessageId,
      taskId:
        this.activeRun.taskId,
      activity:
        persistedActivity,
      skillRun:
        this.activeRun.skillRun
          ? structuredClone(this.activeRun.skillRun)
          : null
    };

    if (
      this.activeRun
        .replaceMessageId
    ) {
      return conversationManager
        .replaceAssistantMessage({
          conversationId,
          messageId:
            this.activeRun
              .replaceMessageId,
          content,
          status,
          preserveCreatedAt:
            Boolean(
              this.activeRun
                .resumeInPlace
            ),
          ...metadata
        });
    }

    return conversationManager
      .appendMessage({
        conversationId,
        role: "assistant",
        content,
        status,
        ...metadata
      });
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
          id: "live"
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
        providerRuntimeDiagnostics: getRuntimeCircuitBreakerSnapshot()
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


  async runE2EMessage({
    runId,
    conversationId,
    context,
    memories,
    settings,
    abortController
  }) {
    try {
      startResponseStream();

      const writeRequest = getE2EToolWriteRequest(
        context.messages
      );

      if (writeRequest) {
        const runSettings = settings ?? getSettings();
        const approvalController = this.createToolApprovalController(
          runId,
          runSettings,
          abortController.signal
        );
        this.activeRun.approvalController = approvalController;
        this.activeRun.toolSecurity = approvalController.securitySnapshot();

        const toolSession = createAgentToolSession({
          activeModel: { provider: "e2e" },
          getAgentStatus: () => this.getStatus(),
          abortSignal: abortController.signal,
          onRecord: (record) => {
            approvalController.markToolRecord(record);
            this.upsertToolRecord(runId, record);
          },
          authorizeTool: (request) =>
            approvalController.authorize(request),
          activityStore: this.activeRun.activityStore,
          settings: runSettings,
          initialPlan:
            this.activeRun.initialPlanState ??
            this.activeRun.initialPlan,
          resultStoreDirectory: getTaskResultDirectory(
            this.activeRun.taskId
          ),
          taskId: this.activeRun.taskId,
          runId,
          workspaceId: this.activeRun.workspaceId ?? "",
          mode: this.activeRun.mode ?? "chat",
          segmentId: "e2e-approved-write",
          capabilityRequest: this.activeRun.skillRuntime?.capabilityRequest ?? null
        });
        this.activeRun.toolSession = toolSession;

        if (!toolSession.tools.write_text_file) {
          const error = new Error(
            "E2E Coding write tool is unavailable."
          );
          error.code = "E2E_WRITE_TOOL_UNAVAILABLE";
          throw error;
        }

        await toolSession.tools.update_plan.execute(
          {
            items: [
              {
                id: "write",
                title: "Write an approved file",
                status: "in_progress"
              }
            ]
          },
          { toolCallId: "e2e-plan-write" }
        );

        const writeResult = await toolSession.tools.write_text_file.execute(
          writeRequest,
          { toolCallId: "e2e-write-file" }
        );

        if (!writeResult?.ok) {
          const error = new Error(
            writeResult?.error?.message ?? "E2E file write failed."
          );
          error.code = writeResult?.error?.code ?? "E2E_WRITE_FAILED";
          throw error;
        }

        await toolSession.tools.update_plan.execute(
          {
            items: [
              {
                id: "write",
                title: "Write an approved file",
                status: "completed"
              }
            ]
          },
          { toolCallId: "e2e-plan-complete" }
        );

        const assistantText = `E2E_TOOL_WRITE_OK:${writeResult.data.path}`;
        this.activeRun.finalText = assistantText;
        appendResponseChunk(assistantText);
        this.finalizeRun({
          runId,
          conversationId,
          executionStopReason: RUN_STOP_REASONS.COMPLETED,
          outcome: RUN_OUTCOMES.COMPLETED,
          content: assistantText
        });
        return;
      }

      await streamE2EResponse({
        messages:
          context.messages,
        memories,
        contextMetadata:
          context.metadata,
        signal:
          abortController.signal,

        onChunk: (
          textPart
        ) => {
          if (
            !this.isCurrentRun(
              runId
            )
          ) {
            return;
          }

          this.activeRun
            .currentStepText +=
            textPart;
          this.activeRun.finalText =
            this.activeRun
              .currentStepText;

          appendResponseChunk(
            textPart
          );

          this.setStatus({
            ...this.status
          });
        }
      });

      if (
        abortController
          .signal
          .aborted
      ) {
        await this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      if (!this.isCurrentRun(runId)) {
        return;
      }

      const assistantText =
        this.activeRun
          .finalText
          .trim();

      this.finalizeRun({
        runId,
        conversationId,
        executionStopReason:
          RUN_STOP_REASONS.COMPLETED,
        outcome: RUN_OUTCOMES.COMPLETED,
        content:
          assistantText || "任务已处理完成。"
      });
    } catch (error) {
      if (
        abortController
          .signal
          .aborted ||
        isAbortError(error)
      ) {
        await this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      if (this.isCurrentRun(runId)) {
        const friendlyMessage = formatAgentError(error);
        const errorText = `⚠ ${friendlyMessage}`;
        appendResponseChunk(errorText);
        this.finalizeRun({
          runId,
          conversationId,
          executionStopReason:
            RUN_STOP_REASONS.MODEL_ERROR,
          outcome: RUN_OUTCOMES.FAILED,
          content: errorText,
          lastError: friendlyMessage
        });
      }
    }
  }

  async runFinalization({
    runId,
    context,
    runtime,
    modelSettings,
    settings,
    records,
    plan,
    executionStopReason,
    goalVerification = null,
    abortController
  }) {
    const maxAttempts =
      settings.tools
        ?.runtime
        ?.maxFinalizationAttempts ??
      1;
    const finalizationTimeoutMs =
      settings.tools
        ?.runtime
        ?.finalizationTimeoutMs ??
      30000;
    const finalizationBudget =
      createFinalizationBudget({
        timeoutMs: finalizationTimeoutMs
      });

    this.beginRunFinalization(
      executionStopReason
    );
    this.activeRun.currentStepText =
      "";
    this.activeRun.liveStepRole =
      LIVE_STEP_ROLES.NONE;
    this.persistActiveRunCheckpoint({
      status: "running"
    });

    this.setStatus({
      ...this.status
    });

    const instruction =
      createFinalizationInstruction({
        plan,
        records,
        executionStopReason,
        goalVerification
      });

    for (
      let attempt = 1;
      attempt <= maxAttempts;
      attempt += 1
    ) {
      if (
        abortController.signal.aborted ||
        !this.isCurrentRun(runId)
      ) {
        return {
          ok: false,
          text: "",
          aborted: true
        };
      }

      this.activeRun
        .finalizationAttemptCount =
        attempt;
      this.activeRun.currentStepText =
        "";
      this.activeRun.liveStepRole =
        LIVE_STEP_ROLES.NONE;
      this.activeRun.finalText =
        "";

      this.setStatus({
        ...this.status
      });

      let text = "";
      const remainingFinalizationMs =
        finalizationBudget.remainingMs();

      if (remainingFinalizationMs <= 0) {
        break;
      }

      try {
        this.assertProviderAvailable(runtime);
        const result = streamText({
          model: runtime.model,

          system: [
            context.system,
            instruction,
            attempt > 1
              ? "The previous finalization attempt returned no usable text. Return a concise final answer now."
              : ""
          ].filter(Boolean).join("\n\n"),

          messages:
            context.messages,

          ...runtime.requestOptions,

          abortSignal:
            abortController.signal,

          timeout:
            finalizationBudget.timeoutFor(
              modelSettings.timeoutMs
            ),

          onError: ({ error }) => {
            console.error(
              "最终总结流式请求错误：",
              error
            );
          }
        });

        for await (
          const textPart
          of result.textStream
        ) {
          if (
            !this.isCurrentRun(runId)
          ) {
            break;
          }

          if (textPart) {
            const firstFinalChunk = text.length === 0;
            text += textPart;
            this.activeRun.finalText =
              text;

            this.setStatus(
              { ...this.status },
              { immediate: firstFinalChunk }
            );

            appendResponseChunk(
              textPart
            );
          }
        }
      } catch (error) {
        if (
          abortController.signal.aborted ||
          isAbortError(error)
        ) {
          throw error;
        }

        this.noteProviderFailure(runtime, error);
        console.warn(
          `最终总结第 ${attempt} 次尝试失败，准备使用下一次尝试或本地兜底：`,
          error
        );
        continue;
      }

      const normalized =
        sanitizeFinalizationText(
          text,
          executionStopReason
        );

      if (normalized) {
        this.noteProviderSuccess(runtime);
        this.activeRun.finalText =
          normalized;
        this.activeRun
          .currentStepText =
          "";
        this.setStatus({
          ...this.status
        });

        return {
          ok: true,
          text: normalized,
          attempts: attempt
        };
      }
    }

    const fallback =
      createFallbackFinalSummary({
        plan,
        records,
        executionStopReason
      });

    this.activeRun.finalText =
      fallback;
    this.activeRun.currentStepText =
      "";
    if (fallback) {
      appendResponseChunk(
        fallback
      );
    }

    this.setStatus({
      ...this.status
    });

    return {
      ok: Boolean(fallback),
      text: fallback,
      attempts: maxAttempts,
      fallback: true
    };
  }

  async executeAgentSegment({
    runId,
    segment,
    segmentSystem,
    context,
    runtime,
    modelSettings,
    toolSession,
    maxSteps,
    abortController,
    remainingRunMs,
    approvalTimeoutMs,
    defaultToolTimeoutMs
  }) {
    this.assertProviderAvailable(runtime);
    const result = streamText({
      model: runtime.model,
      system: segmentSystem,
      messages: context.messages,
      tools: toolSession.tools,
      stopWhen: stepCountIs(maxSteps),
      ...runtime.requestOptions,
      abortSignal: abortController.signal,
      timeout: createAgentStreamTimeout({
        modelTimeoutMs: modelSettings.timeoutMs,
        remainingRunMs,
        approvalTimeoutMs,
        defaultToolTimeoutMs,
        hasApprovalGatedTools: toolSession.definitions.some(
          (definition) => [
            "local_write",
            "remote_write",
            "destructive"
          ].includes(definition.runtimeContract?.effect)
        )
      }),
      prepareStep: ({
        stepNumber,
        initialMessages,
        responseMessages
      }) => {
        if (
          stepNumber < 4 ||
          !this.isCurrentRun(runId)
        ) {
          return undefined;
        }

        const compacted = compactRunStepContext({
          initialMessages,
          responseMessages,
          checkpoint: this.buildActiveCheckpoint(),
          contextTokenBudget:
            modelSettings.contextTokenBudget,
          outputReserve:
            modelSettings.maxOutputTokens ?? 4096
        });

        if (!compacted.compacted) {
          return undefined;
        }

        this.activeRun.contextCompactionCount += 1;
        this.persistActiveRunCheckpoint({
          status: "running"
        });

        return {
          messages: compacted.messages,
          instructions: [
            segmentSystem,
            compacted.checkpointInstruction,
            "Earlier tool details were compacted to protect the context budget. Use the checkpoint and result references; do not repeat completed work."
          ].filter(Boolean).join("\n\n")
        };
      },
      onStepStart: ({ stepNumber }) => {
        if (!this.isCurrentRun(runId)) {
          return;
        }

        this.activeRun.currentStepText = "";
        this.activeRun.liveStepRole =
          inferLiveStepRole({
            records: toolSession.getRecords()
          });
        this.activeRun.stepNumber =
          Number(stepNumber) || 0;
        const stepId = `${segment.id}:step:${this.activeRun.stepNumber}`;
        this.activeRun.toolSession?.beginStep?.({
          stepId,
          segmentId: segment.id
        });
        void this.activeRun.toolSession?.recordRuntimeEvent?.(
          "MODEL_STEP_STARTED",
          { stepId, stepNumber: this.activeRun.stepNumber },
          { runId, segmentId: segment.id }
        );
        this.setStatus({
          ...this.status
        });
      },
      onStepEnd: (step) => {
        this.handleStepEnd(runId, step);
      },
      onError: ({ error }) => {
        console.error(
          "模型流式请求错误：",
          error
        );
      }
    });

    for await (const textPart of result.textStream) {
      if (!this.isCurrentRun(runId)) {
        break;
      }

      if (textPart) {
        this.activeRun.currentStepText += textPart;
        appendResponseChunk(textPart);
        this.setStatus({
          ...this.status
        });
      }
    }

    const records = toolSession.getRecords();
    const finishReason = await settleResultValue(
      result.finishReason,
      "unknown"
    );
    const steps = await settleResultValue(
      result.steps,
      []
    );
    const plan = toolSession.getPlan();
    const executionStopReason = inferRunStopReason({
      records,
      finishReason,
      steps,
      maxSteps,
      plan
    });
    const segmentRecords = records.filter(
      (record) => record?.segmentId === segment.id
    );
    const batchFailed = segmentRecords.some(
      (record) => ["failed", "error"].includes(record?.status)
    );
    this.activeRun.activityStore?.closeBatch(
      batchFailed ? "failed" : "completed"
    );

    this.noteProviderSuccess(runtime);
    return {
      records,
      finishReason,
      steps,
      plan,
      executionStopReason,
      finalText: this.activeRun.finalText
    };
  }

  async runMessage({
    runId,
    conversationId,
    context,
    settings,
    abortController
  }) {
    let runtime = null;
    try {
      const runSettings = settings ?? getSettings();
      const modelSettings = resolveActiveModelSettings(
        runSettings.model
      );
      runtime = createModelRuntime(modelSettings);
      const runtimeSettings = runSettings.tools?.runtime ?? {};
      const orchestrator = new LongTaskOrchestrator({
        goal: this.activeRun.goalSpec,
        goalId: this.activeRun.goalId,
        taskId: this.activeRun.taskId,
        runId,
        objective: this.activeRun.objective,
        maxSegmentSteps: runtimeSettings.maxSteps ?? 6,
        maxSegments: this.activeRun.goalSpec?.autoContinue === false
          ? 1
          : runtimeSettings.maxSegments ?? 6,
        maxNoProgressSegments:
          runtimeSettings.maxNoProgressSegments ?? 2,
        startedAt: this.activeRun.startedAt
      });
      this.activeRun.orchestrator = orchestrator;

      const mcpDefinitions = await mcpClientManager
        .prepareForAgent(runSettings)
        .catch((error) => {
          console.warn("MCP 工具准备失败，将继续使用其他工具：", error);
          return [];
        });
      const externalDefinitions = [
        ...mcpDefinitions,
        ...declarativeHttpToolManager.getToolDefinitions(runSettings),
        ...(this.activeRun.platformRunId
          ? [createDelegationToolDefinition({
              getPlatformRunId: () => this.activeRun?.platformRunId ?? ""
            })]
          : [])
      ];

      const approvalController = this.createToolApprovalController(
        runId,
        runSettings,
        abortController.signal
      );
      this.activeRun.approvalController = approvalController;
      this.activeRun.toolSecurity = approvalController.securitySnapshot();

      const toolSession = createAgentToolSession({
        activeModel: modelSettings,
        externalDefinitions,
        getAgentStatus: () => this.getStatus(),
        abortSignal: abortController.signal,
        onRecord: (record) => {
          approvalController.markToolRecord(record);
          this.upsertToolRecord(runId, record);
        },
        authorizeTool: (request) =>
          approvalController.authorize(request),
        onPlanChange: (plan, change) => {
          if (!this.isCurrentRun(runId)) {
            return;
          }

          if (change?.scope !== "step_work") {
            this.activeRun.activityStore?.recordPlan(
              plan,
              Date.now(),
              change
            );
          }
          this.persistActiveRunCheckpoint({
            status: "running"
          });
          this.setStatus({
            ...this.status
          });
        },
        activityStore: this.activeRun.activityStore,
        settings: runSettings,
        initialPlan:
          this.activeRun.initialPlanState ??
          this.activeRun.initialPlan,
        resultStoreDirectory: getTaskResultDirectory(
          this.activeRun.taskId
        ),
        taskId: this.activeRun.taskId,
        runId,
        workspaceId:
          this.activeRun.workspaceId ?? "",
        mode: this.activeRun.mode ?? "chat",
        getSegmentId: () => orchestrator.currentSegmentId(),
        segmentId: runId,
        capabilityRequest: this.activeRun.skillRuntime?.capabilityRequest ?? null
      });

      this.activeRun.toolSession = toolSession;
      if (this.activeRun.skillRun) {
        const resolution = toolSession.capabilityResolution;
        this.activeRun.skillRun = {
          ...this.activeRun.skillRun,
          selectedToolNames: [...(resolution?.selectedToolNames ?? [])],
          missingRequired: [...(resolution?.missingRequired ?? [])]
        };
        this.activeRun.activityStore?.recordSkill({
          skill: this.activeRun.skillRuntime.skill,
          skills: this.activeRun.skillRuntime.skills,
          source: this.activeRun.skillRuntime.source,
          router: this.activeRun.skillRuntime.router,
          status: "running",
          selectedToolNames: this.activeRun.skillRun.selectedToolNames,
          missingRequired: this.activeRun.skillRun.missingRequired
        });
        if (this.activeRun.skillRun.missingRequired.length > 0) {
          const error = new Error(
            `Skill 缺少必需能力：${this.activeRun.skillRun.missingRequired.join(", ")}`
          );
          error.code = "SKILL_CAPABILITY_MISSING";
          throw error;
        }
      }
      await toolSession.recordRuntimeEvent?.(
        "RUN_STARTED",
        {
          goalId: this.activeRun.goalId,
          objective: this.activeRun.objective,
          continuationCount: this.activeRun.continuationCount,
          skillId: this.activeRun.skillRuntime?.skill?.id ?? "",
          skillIds: this.activeRun.skillRuntime?.rootSkillIds ?? [],
          skillSource: this.activeRun.skillRuntime?.source ?? "none"
        },
        { runId }
      );
      await toolSession.reconcileRuntime?.();
      const runtimeRecovery = toolSession.getRuntimeRecovery?.();
      if (runtimeRecovery?.unresolvedCount > 0) {
        this.activeRun.activityStore?.recordRecovery(
          runtimeRecovery
        );
      }
      const activeCapabilityContext = buildCapabilityContext({
        toolSettings: runSettings.tools,
        toolManifest: toolSession.definitions
      });
      const activePromptSections =
        (context.promptSections ?? []).map((section) =>
          section.id === "capabilities"
            ? {
                ...section,
                content: activeCapabilityContext
              }
            : section
        );

      if (activePromptSections.length > 0) {
        context.promptSections = activePromptSections;
        context.system = [
          renderPromptSections(activePromptSections),
          context.runtimeInstructions
        ].filter(Boolean).join("\n\n");
      }

      startResponseStream();

      const maxSteps = runtimeSettings.maxSteps ?? 6;
      const runTimeoutMs =
        runtimeSettings.runTimeoutMs ?? modelSettings.timeoutMs;
      const runDeadline = this.activeRun.startedAt + runTimeoutMs;
      let segmentSystem = context.system;

      const segmentLoop = new SegmentExecutionLoop({
        orchestrator,
        runDeadline,
        signal: abortController.signal,
        isActive: () => this.isCurrentRun(runId)
      });

      const runEngine = new RunEngine({
        segmentLoop
      });

      const engineResult = await runEngine.run({
        segmentCallbacks: {
          getPlan: () => toolSession.getPlan(),
          getRecords: () => toolSession.getRecords(),
          getCompletionContext: () => ({
            mode: this.activeRun.mode ?? "chat",
            availableToolNames: Object.keys(toolSession.tools ?? {}),
            runtimeRecovery: toolSession.getRuntimeRecovery?.() ?? null
          }),
          createCheckpoint: () => {
            const checkpoint = this.buildActiveCheckpoint();
            if (checkpoint) {
              checkpoint.orchestration = null;
            }
            return checkpoint;
          },
          onSegmentStart: async ({ segment }) => {
            this.activeRun.currentSegmentId = segment.id;
            if (this.activeRun.persistentGoalId) {
              conversationManager.heartbeatGoal({
                conversationId,
                goalId: this.activeRun.persistentGoalId,
                runId,
                phase: "executing"
              });
            }
            await toolSession.recordRuntimeEvent?.(
              "SEGMENT_STARTED",
              {
                segmentIndex: segment.index,
                objective: segment.objective ?? this.activeRun.objective
              },
              { runId, segmentId: segment.id }
            );
            this.markRunExecuting();
            this.persistActiveRunCheckpoint({
              status: "running"
            });
            this.activeRun.activityStore?.recordProgress({
              title:
                segment.index === 1
                  ? "开始执行任务"
                  : "继续执行任务",
              status: "running"
            });
          },
          executeSegment: ({ segment, remainingRunMs }) =>
            this.executeAgentSegment({
              runId,
              segment,
              segmentSystem,
              context,
              runtime,
              modelSettings,
              toolSession,
              maxSteps,
              abortController,
              remainingRunMs,
              approvalTimeoutMs:
                runSettings.tools?.security?.approval?.timeoutMs,
              defaultToolTimeoutMs:
                runtimeSettings.defaultTimeoutMs
            }),
          onSegmentComplete: async ({
            segment,
            segmentOutcome,
            checkpoint
          }) => {
            this.activeRun.currentSegmentId = "";
            if (this.activeRun.persistentGoalId) {
              conversationManager.heartbeatGoal({
                conversationId,
                goalId: this.activeRun.persistentGoalId,
                runId,
                phase: "evaluating"
              });
              if (checkpoint) {
                conversationManager.recordGoalCheckpoint({
                  conversationId,
                  goalId: this.activeRun.persistentGoalId,
                  checkpoint: {
                    ...checkpoint,
                    segmentId: segment.id
                  }
                });
              }
              if (segmentOutcome.decision === "continue") {
                conversationManager.transitionGoal({
                  conversationId,
                  goalId: this.activeRun.persistentGoalId,
                  phase: "replanning",
                  reason: segmentOutcome.stopReason || "continue-goal-run",
                  runId,
                  force: true
                });
              }
            }
            const title =
              segmentOutcome.decision === "continue"
                ? segmentOutcome.verification?.verified === false
                  ? "完成证据不足，继续验证"
                  : "已整理当前进展，继续执行"
                : segmentOutcome.decision === "checkpoint"
                  ? "当前阶段进展已整理"
                  : "当前阶段已完成";
            this.activeRun.activityStore?.recordProgress({
              title,
              status: [
                "continue",
                "complete",
                "checkpoint"
              ].includes(segmentOutcome.decision)
                ? "completed"
                : "failed",
              stopReason: segmentOutcome.stopReason
            });
            if (this.activeRun.persistentGoalId && segmentOutcome.verification) {
              conversationManager.recordGoalVerification({
                conversationId,
                goalId: this.activeRun.persistentGoalId,
                verification: segmentOutcome.verification
              });
            }
            await toolSession.recordRuntimeEvent?.(
              "SEGMENT_COMMITTED",
              {
                decision: segmentOutcome.decision,
                stopReason: segmentOutcome.stopReason,
                checkpointStored: Boolean(checkpoint),
                goalVerification: segmentOutcome.verification ?? null
              },
              { runId, segmentId: segment.id }
            );
            if (checkpoint) {
              await toolSession.storeRuntimeCheckpoint?.(
                {
                  ...checkpoint,
                  toolRuntime: toolSession.getRuntimeRecovery?.(),
                  ...toolSession.getRuntimeCursor?.()
                },
                { runId, segmentId: segment.id }
              );
            }
          },
          onContinue: ({ checkpoint, segmentOutcome }) => {
            this.activeRun.finalText = "";
            this.activeRun.currentStepText = "";
            this.activeRun.liveStepRole =
              LIVE_STEP_ROLES.NONE;
            this.activeRun.activityStore?.updateCheckpoint(
              checkpoint
            );
            segmentSystem = [
              context.system,
              createCheckpointInstruction(checkpoint),
              createGoalVerificationInstruction(
                segmentOutcome?.verification
              ),
              "[Continued execution] Continue the same task from the saved task state. Advance unfinished work; do not repeat completed tool calls. If required user input is missing, mark the current plan step needs_input and provide a final explanation. Do not mention internal execution slices or counters to the user."
            ].filter(Boolean).join("\n\n");
            this.persistActiveRunCheckpoint({
              status: "running"
            });
          }
        },
        getFinalText: () =>
          this.activeRun?.finalText ?? "",
        setFinalText: (value) => {
          if (this.activeRun) {
            this.activeRun.finalText = value;
          }
        },
        appendFinalText: (value) => {
          appendResponseChunk(value);
        },
        onLoopResult: ({
          loopResult,
          records
        }) => {
          if (!this.isCurrentRun(runId)) {
            return;
          }

          this.activeRun.toolCalls = records;

          if (["run_timeout", "segment_limit"].includes(loopResult.source)) {
            this.activeRun.activityStore?.recordProgress({
              title:
                loopResult.source === "run_timeout"
                  ? "当前进展已整理"
                  : "当前阶段进展已整理",
              status: "completed",
              stopReason: loopResult.stopReason
            });
          }
        },
        runFinalization: ({
          records,
          plan,
          executionStopReason,
          goalVerification
        }) =>
          this.runFinalization({
            runId,
            context,
            runtime,
            modelSettings,
            settings,
            records,
            plan,
            executionStopReason,
            goalVerification,
            abortController
          })
      });

      if (
        abortController.signal.aborted ||
        engineResult.cancelled
      ) {
        await this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      if (!this.isCurrentRun(runId)) {
        return;
      }

      if (
        this.activeRun.persistentGoalId &&
        engineResult.outcome === RUN_OUTCOMES.COMPLETED &&
        engineResult.loopResult?.verification?.verified === true
      ) {
        const completion = this.activeRun.platformRunId
          ? platformKernel.authorizeCompletion({
              platformRunId: this.activeRun.platformRunId,
              agentRunId: runId,
              verification: engineResult.loopResult.verification,
              records: engineResult.records
            })
          : {
              ok: false,
              code: this.activeRun.platformError?.code ??
                "platform-completion-authority-unavailable"
            };
        if (completion.ok) {
          const completedGoal = conversationManager.completeGoal({
            conversationId,
            goalId: this.activeRun.persistentGoalId,
            verification: completion.verification ?? engineResult.loopResult.verification,
            completionPermit: completion.permit
          });
          if (completedGoal.ok) {
            platformKernel.setRunStatus(
              this.activeRun.platformRunId,
              "completed",
              "goal-completion-authorized"
            );
          } else {
            platformKernel.setRunStatus(
              this.activeRun.platformRunId,
              "blocked",
              completedGoal.code
            );
          }
        }
      }

      const finalCheckpoint = this.buildActiveCheckpoint();
      if (finalCheckpoint) {
        await toolSession.storeRuntimeCheckpoint?.(
          finalCheckpoint,
          { runId }
        );
      }
      await toolSession.recordRuntimeEvent?.(
        "RUN_COMPLETED",
        {
          outcome: engineResult.outcome,
          stopReason: engineResult.executionStopReason,
          goalVerification:
            engineResult.loopResult?.verification ?? null
        },
        { runId }
      );

      this.finalizeRun({
        runId,
        conversationId,
        executionStopReason:
          engineResult.executionStopReason,
        outcome: engineResult.outcome,
        content:
          engineResult.finalText || "任务已处理完成。"
      });
    } catch (error) {
      this.noteProviderFailure(runtime, error);
      if (
        abortController.signal.aborted ||
        isAbortError(error)
      ) {
        await this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      const friendlyMessage = formatAgentError(error);

      console.error(
        "Agent 运行失败：",
        error
      );

      if (!this.isCurrentRun(runId)) {
        return;
      }

      const records =
        this.activeRun.toolSession?.getRecords?.() ??
        this.activeRun.toolCalls ?? [];
      const plan =
        this.activeRun.toolSession?.getPlan?.() ??
        this.activeRun.initialPlan ?? [];
      const hasRecoverableState =
        records.some((record) => record?.status === "completed") ||
        plan.length > 0;
      const executionStopReason = hasRecoverableState
        ? RUN_STOP_REASONS.MODEL_RECOVERY
        : RUN_STOP_REASONS.MODEL_ERROR;

      this.activeRun.orchestrator?.terminate(
        executionStopReason
      );

      if (hasRecoverableState) {
        this.activeRun.toolCalls = records;
        this.activeRun.activityStore?.recordProgress({
          title: "当前进展已整理",
          status: "completed",
          stopReason: executionStopReason
        });
        const fallback = createFallbackFinalSummary({
          plan,
          records,
          executionStopReason
        });
        const recoveryCheckpoint = this.buildActiveCheckpoint();
        if (recoveryCheckpoint) {
          await this.activeRun.toolSession
            ?.storeRuntimeCheckpoint?.(
              recoveryCheckpoint,
              { runId }
            );
        }
        await this.activeRun.toolSession
          ?.recordRuntimeEvent?.(
            "RUN_INTERRUPTED",
            {
              outcome: "continuable",
              stopReason: executionStopReason,
              error: friendlyMessage
            },
            { runId }
          );

        startResponseStream();
        appendResponseChunk(fallback);

        this.finalizeRun({
          runId,
          conversationId,
          executionStopReason,
          outcome: RUN_OUTCOMES.CONTINUABLE,
          content: fallback
        });
        return;
      }

      await this.activeRun.toolSession
        ?.recordRuntimeEvent?.(
          "RUN_FAILED",
          {
            outcome: "failed",
            stopReason: executionStopReason,
            error: friendlyMessage
          },
          { runId }
        );
      const failedCheckpoint = this.buildActiveCheckpoint();
      if (failedCheckpoint) {
        await this.activeRun.toolSession
          ?.storeRuntimeCheckpoint?.(
            failedCheckpoint,
            { runId }
          );
      }

      const errorText = `⚠ ${friendlyMessage}`;
      startResponseStream();
      appendResponseChunk(errorText);

      this.finalizeRun({
        runId,
        conversationId,
        executionStopReason,
        outcome: RUN_OUTCOMES.FAILED,
        content: errorText,
        lastError: friendlyMessage
      });
    }
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
