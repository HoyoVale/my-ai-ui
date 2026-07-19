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
  getSettings
} from "../settings/settingsStore.js";

import {
  bindSettingsToConversationWorkspace
} from "../workspace/workspaceRegistry.js";

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
  startResponseStream
} from "../windows/response/index.js";

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
  isE2EMode,
  streamE2EResponse
} from "./e2eAgentDriver.js";

import {
  createAgentToolSession
} from "../tools/index.js";

import {
  RunActivityStore
} from "./RunActivityStore.js";

import {
  inferRunStopReason,
  isGracefulRunBoundary,
  RUN_STOP_REASONS
} from "./runStopReasons.js";

import {
  classifyAgentStep
} from "./stepText.js";

import {
  compactRunStepContext
} from "./contextCompaction.js";

import {
  createCheckpointInstruction,
  createRunCheckpoint
} from "./runCheckpoint.js";

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
  RUN_OUTCOMES
} from "./RunStateMachine.js";

import {
  RunEngine
} from "./RunEngine.js";

import {
  createFinalizationBudget
} from "./finalizationBudget.js";

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

  getStatus() {
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
        this.activeRun
          ?.finalText ??
        this.activeRun
          ?.currentStepText ??
        "",
      liveStepText:
        this.activeRun
          ?.currentStepText ?? "",
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
          ?.checkpoint ?? null
    });
  }

  buildActiveCheckpoint() {
    if (!this.activeRun) {
      return null;
    }

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
        this.activeRun.finalText ?? "",
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
    const state = this.applyRunState(
      run.stateMachine.finalize({
        executionStopReason,
        outcome,
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
    run.activityStore?.finalize(
      state.executionStopReason,
      state.endedAt,
      {
        status: state.activityStatus,
        outcome: state.outcome,
        resumable: state.resumable
      }
    );
    run.activityStore?.updateCheckpoint(
      this.buildActiveCheckpoint()
    );

    this.persistAssistantResponse({
      conversationId,
      content: run.finalText,
      status: state.messageStatus
    });
    void run.toolSession
      ?.closePersistence?.();

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
    });

    return finalState;
  }

  finishCancelledRun({
    runId,
    conversationId
  }) {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    const savePartial =
      getSettings()
        .conversation
        .saveAbortedReplies;
    const content = savePartial
      ? this.activeRun.finalText.trim()
      : "";

    this.finalizeRun({
      runId,
      conversationId,
      executionStopReason:
        RUN_STOP_REASONS.CANCELLED_BY_USER,
      outcome: RUN_OUTCOMES.CANCELLED,
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
      bindSettingsToConversationWorkspace(
        getSettings(),
        credentialConversation
      );
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
    let checkpointContinuation = null;
    let continuationState = null;

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

      conversationManager
        .appendMessage({
          conversationId:
            conversation.id,
          role: "user",
          content: message
        });

      conversation =
        conversationManager
          .getConversation(
            conversation.id
          );

      memories =
        memoryManager.retrieve({
          query: message
        });

      executionConversation = continuationState
        ? {
            ...conversation,
            mode: continuationState.mode ?? conversation.mode,
            workspaceId:
              continuationState.workspaceId === undefined
                ? conversation.workspaceId
                : continuationState.workspaceId,
            workspaceSnapshot:
              continuationState.workspaceSnapshot ?? conversation.workspaceSnapshot,
            modelSelection:
              continuationState.modelSelection ?? conversation.modelSelection,
            modelSnapshot:
              continuationState.modelSnapshot ?? conversation.modelSnapshot
          }
        : conversation;
      const binding =
        bindSettingsToConversationWorkspace(
          getSettings(),
          executionConversation
        );
      runSettings = binding.settings;
      activeWorkspace = binding.workspace;

      context =
        assembleAgentContext({
          settings: runSettings,
          conversation:
            executionConversation,
          memories
        });

      context = appendTaskContinuationToContext(
        context,
        checkpointContinuation,
        continuationState,
        message
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

    const goalId =
      continuationState?.goalId ||
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
        continuationState?.objective || message,
      continuationInstruction:
        continuationState ? message : "",
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
      activeWorkspace,
      conversationId:
        conversation.id,
      abortController,
      currentStepText: "",
      finalText: "",
      stepNumber: 0,
      startedAt,
      replaceMessageId: null,
      toolCalls: [],
      activityStore,
      initialPlan:
        continuationState?.initialPlan ?? [],
      resumedFromMessageId:
        continuationState?.resumedFromMessageId ?? "",
      resumeInPlace: false,
      finalizationAttemptCount: 0,
      contextCompactionCount:
        continuationState?.contextCompactionCount ?? 0,
      ...createRunStateFields(startedAt)
    };

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

      memories =
        memoryManager.retrieve({
          query:
            plan.userMessage
              .content
        });

      const binding =
        bindSettingsToConversationWorkspace(
          getSettings(),
          plan.conversation
        );
      runSettings = binding.settings;
      activeWorkspace = binding.workspace;

      context =
        assembleAgentContext({
          settings: runSettings,
          conversation:
            plan.conversation,
          memories
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

    const goalId =
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
      objective: plan.userMessage.content,
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
      activeWorkspace,
      conversationId:
        plan.conversation.id,
      abortController,
      currentStepText: "",
      finalText: "",
      stepNumber: 0,
      startedAt,
      replaceMessageId:
        plan.targetMessage.id,
      toolCalls: [],
      activityStore,
      initialPlan: [],
      resumedFromMessageId: "",
      resumeInPlace: false,
      finalizationAttemptCount: 0,
      contextCompactionCount: 0,
      ...createRunStateFields(startedAt)
    };

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
            this.activeRun
              .activityStore
              ?.events
              ?.some(
                (event) =>
                  event.type ===
                    "tool"
              )
              ? "between_tools"
              : "before_tools",
          objective:
            classified.objective
        });
    } else if (
      classified.kind ===
        "final"
    ) {
      this.activeRun.finalText =
        classified.text;
    }

    this.activeRun.currentStepText =
      "";
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
      getSettings().tools
        ?.runtime
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
        persistedActivity
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

    try {
      const runtime =
        createModelRuntime(
          modelSettings
        );

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

      return {
        ok: true,
        latencyMs:
          Date.now() -
          startedAt,
        text:
          result.text.trim()
      };
    } catch (error) {
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
    abortController
  }) {
    try {
      startResponseStream();

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
        this.finishCancelledRun({
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
        this.finishCancelledRun({
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
    abortController
  }) {
    const bufferProgressHandoff =
      isGracefulRunBoundary(
        executionStopReason
      );
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
        executionStopReason
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
            text += textPart;
            if (!bufferProgressHandoff) {
              this.activeRun
                .currentStepText =
                text;
              this.activeRun.finalText =
                text;

              appendResponseChunk(
                textPart
              );

              this.setStatus({
                ...this.status
              });
            }
          }
        }
      } catch (error) {
        if (
          abortController.signal.aborted ||
          isAbortError(error)
        ) {
          throw error;
        }

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
        this.activeRun.finalText =
          normalized;
        this.activeRun
          .currentStepText =
          "";
        if (bufferProgressHandoff) {
          appendResponseChunk(
            normalized
          );
        }

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
    remainingRunMs
  }) {
    const result = streamText({
      model: runtime.model,
      system: segmentSystem,
      messages: context.messages,
      tools: toolSession.tools,
      stopWhen: stepCountIs(maxSteps),
      ...runtime.requestOptions,
      abortSignal: abortController.signal,
      timeout: {
        totalMs: Math.max(
          1,
          Math.min(modelSettings.timeoutMs, remainingRunMs)
        ),
        chunkMs: Math.min(45000, modelSettings.timeoutMs)
      },
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
        this.activeRun.stepNumber =
          Number(stepNumber) || 0;
        this.activeRun.toolSession?.beginStep?.({
          stepId: `${segment.id}:step:${this.activeRun.stepNumber}`,
          segmentId: segment.id
        });
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
    try {
      const runSettings = settings ?? getSettings();
      const modelSettings = resolveActiveModelSettings(
        runSettings.model
      );
      const runtime = createModelRuntime(modelSettings);
      const runtimeSettings = runSettings.tools?.runtime ?? {};
      const orchestrator = new LongTaskOrchestrator({
        goalId: this.activeRun.goalId,
        taskId: this.activeRun.taskId,
        runId,
        objective: this.activeRun.objective,
        maxSegmentSteps: runtimeSettings.maxSteps ?? 6,
        maxSegments: runtimeSettings.maxSegments ?? 6,
        maxNoProgressSegments:
          runtimeSettings.maxNoProgressSegments ?? 2,
        startedAt: this.activeRun.startedAt
      });
      this.activeRun.orchestrator = orchestrator;

      const toolSession = createAgentToolSession({
        activeModel: modelSettings,
        getAgentStatus: () => this.getStatus(),
        abortSignal: abortController.signal,
        onRecord: (record) => {
          this.upsertToolRecord(runId, record);
        },
        onPlanChange: (plan, change) => {
          if (!this.isCurrentRun(runId)) {
            return;
          }

          this.activeRun.activityStore?.recordPlan(
            plan,
            Date.now(),
            change
          );
          this.persistActiveRunCheckpoint({
            status: "running"
          });
          this.setStatus({
            ...this.status
          });
        },
        activityStore: this.activeRun.activityStore,
        settings: runSettings,
        initialPlan: this.activeRun.initialPlan,
        resultStoreDirectory: getTaskResultDirectory(
          this.activeRun.taskId
        ),
        taskId: this.activeRun.taskId,
        workspaceId:
          this.activeRun.workspaceId ?? "",
        getSegmentId: () => orchestrator.currentSegmentId(),
        segmentId: runId
      });

      this.activeRun.toolSession = toolSession;
      const activeCapabilityContext = buildCapabilityContext({
        toolSettings: runSettings.tools,
        toolManifest: toolSession.registryManifest
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
          createCheckpoint: () => {
            const checkpoint = this.buildActiveCheckpoint();
            if (checkpoint) {
              checkpoint.orchestration = null;
            }
            return checkpoint;
          },
          onSegmentStart: ({ segment }) => {
            this.activeRun.currentSegmentId = segment.id;
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
              remainingRunMs
            }),
          onSegmentComplete: ({
            segmentOutcome
          }) => {
            this.activeRun.currentSegmentId = "";
            const title =
              segmentOutcome.decision === "continue"
                ? "已整理当前进展，继续执行"
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
          },
          onContinue: ({ checkpoint }) => {
            this.activeRun.finalText = "";
            this.activeRun.currentStepText = "";
            this.activeRun.activityStore?.updateCheckpoint(
              checkpoint
            );
            segmentSystem = [
              context.system,
              createCheckpointInstruction(checkpoint),
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
          executionStopReason
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
            abortController
          })
      });

      if (
        abortController.signal.aborted ||
        engineResult.cancelled
      ) {
        this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      if (!this.isCurrentRun(runId)) {
        return;
      }

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
      if (
        abortController.signal.aborted ||
        isAbortError(error)
      ) {
        this.finishCancelledRun({
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

  setStatus(nextStatus) {
    this.status = {
      ...nextStatus
    };

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

      window
        .webContents
        .send(
          IPC_CHANNELS
            .agent
            .STATUS_CHANGED,

          this.getStatus()
        );
    }
  }
}

export const agentRuntime =
  new AgentRuntime();
