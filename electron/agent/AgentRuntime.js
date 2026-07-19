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
  getPlanCompletionState,
  sanitizeFinalizationText,
  shouldRunFinalization
} from "./finalization.js";

import {
  LongTaskOrchestrator
} from "./orchestration/LongTaskOrchestrator.js";





function getActiveCredentialError() {
  try {
    const modelSettings =
      resolveActiveModelSettings(
        getSettings().model
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

    this.activeRun.phase = "cancelled";
    this.activeRun.stopReason =
      RUN_STOP_REASONS.CANCELLED_BY_USER;
    this.activeRun.orchestrator?.terminate(
      this.activeRun.stopReason
    );
    this.activeRun.activityStore
      ?.finalize(
        this.activeRun.stopReason
      );
    this.persistActiveRunCheckpoint({
      status: "aborted"
    });
    this.persistAssistantResponse({
      conversationId,
      content,
      status: "aborted"
    });

    this.activeRun = null;
    this.setStatus({
      state: "idle",
      runId: null,
      conversationId,
      startedAt: null,
      lastError: null,
      stopReason:
        RUN_STOP_REASONS.CANCELLED_BY_USER
    });
  }

  startMessage(
    content,
    {
      expectedConversationId = ""
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

    const credentialError =
      isE2EMode()
        ? null
        : getActiveCredentialError();

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
    let checkpointContinuation = null;
    let continuationState = null;

    try {
      conversation =
        conversationManager
          .getCurrentConversation();

      if (
        expectedConversationId &&
        conversation.id !==
          expectedConversationId
      ) {
        return {
          ok: false,
          code: "conversation-changed",
          message:
            "当前会话已经切换，请回到原会话后重新提交回答。"
        };
      }

      checkpointContinuation =
        resolveCheckpointContinuation({
          conversation,
          message
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

      context =
        assembleAgentContext({
          settings:
            getSettings(),
          conversation,
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
      phase: "executing",
      finalizationAttemptCount: 0,
      contextCompactionCount:
        continuationState?.contextCompactionCount ?? 0,
      executionStopReason: null,
      stopReason: null
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

      context =
        assembleAgentContext({
          settings:
            getSettings(),
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
      phase: "executing",
      finalizationAttemptCount: 0,
      contextCompactionCount: 0,
      executionStopReason: null,
      stopReason: null
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
        this.activeRun
          .stopReason ??
        (status === "aborted"
          ? RUN_STOP_REASONS
              .CANCELLED_BY_USER
          : RUN_STOP_REASONS
              .COMPLETED),
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

    this.activeRun.phase =
      "cancelling";
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

      endResponseStream();

      if (
        abortController
          .signal
          .aborted ||
        !this.isCurrentRun(
          runId
        )
      ) {
        return;
      }

      const assistantText =
        this.activeRun
          .finalText
          .trim();

      if (assistantText) {
        this.activeRun.stopReason =
          RUN_STOP_REASONS
            .COMPLETED;
        this.activeRun
          .activityStore
          ?.finalize(
            this.activeRun
              .stopReason
          );
        this.activeRun.activityStore
          ?.updateCheckpoint(
            this.buildActiveCheckpoint()
          );
        this.persistAssistantResponse({
          conversationId,
          content:
            assistantText,
          status: "complete"
        });
      }

      this.activeRun = null;

      this.setStatus({
        state: "idle",
        runId: null,
        conversationId,
        startedAt: null,
        lastError: null
      });
    } catch (error) {
      endResponseStream();

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

      throw error;
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
      2;

    this.activeRun.phase =
      "finalizing";
    this.activeRun.currentStepText =
      "";

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

          timeout: {
            totalMs:
              Math.min(
                modelSettings.timeoutMs,
                settings.tools
                  ?.runtime
                  ?.runTimeoutMs ??
                modelSettings.timeoutMs
              ),

            chunkMs:
              Math.min(
                45000,
                modelSettings.timeoutMs
              )
          },

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
        this.activeRun.phase =
          "completed";

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
    this.activeRun.phase =
      "completed";

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

  async runMessage({
    runId,
    conversationId,
    context,
    abortController
  }) {
    try {
      const settings =
        getSettings();

      const modelSettings =
        resolveActiveModelSettings(
          settings.model
        );

      const runtime =
        createModelRuntime(
          modelSettings
        );

      const runtimeSettings =
        settings.tools?.runtime ?? {};
      const orchestrator =
        new LongTaskOrchestrator({
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

      const toolSession =
        createAgentToolSession({
          activeModel:
            modelSettings,
          getAgentStatus: () =>
            this.getStatus(),
          abortSignal:
            abortController.signal,
          onRecord: (record) => {
            this.upsertToolRecord(
              runId,
              record
            );
          },
          onPlanChange: (plan, change) => {
            if (
              this.isCurrentRun(
                runId
              )
            ) {
              this.activeRun
                .activityStore
                ?.recordPlan(
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
            }
          },
          activityStore:
            this.activeRun.activityStore,
          settings,
          initialPlan:
            this.activeRun
              .initialPlan,
          resultStoreDirectory:
            getTaskResultDirectory(
              this.activeRun.taskId
            ),
          taskId:
            this.activeRun.taskId,
          getSegmentId: () =>
            orchestrator.currentSegmentId(),
          segmentId:
            runId
        });

      this.activeRun.toolSession =
        toolSession;
      const activeCapabilityContext = buildCapabilityContext({
        toolSettings: settings.tools,
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

      const maxSteps =
        settings.tools
          ?.runtime
          ?.maxSteps ?? 6;

      const runTimeoutMs =
        runtimeSettings.runTimeoutMs ??
        modelSettings.timeoutMs;
      const runDeadline =
        this.activeRun.startedAt + runTimeoutMs;
      let segmentSystem =
        context.system;

      while (true) {
        if (
          abortController.signal.aborted ||
          !this.isCurrentRun(runId)
        ) {
          break;
        }

        const remainingRunMs =
          runDeadline - Date.now();

        if (remainingRunMs <= 0) {
          this.activeRun.stopReason =
            RUN_STOP_REASONS.AGENT_RUN_TIMEOUT;
          this.activeRun.executionStopReason =
            RUN_STOP_REASONS.AGENT_RUN_TIMEOUT;
          orchestrator.terminate(
            this.activeRun.stopReason
          );
          this.activeRun.phase = "checkpoint_ready";
          this.activeRun.activityStore?.recordProgress({
            title: "当前进展已整理",
            status: "completed",
            stopReason: this.activeRun.stopReason
          });
          const records = toolSession.getRecords();
          const plan = toolSession.getPlan();
          this.activeRun.toolCalls = records;
          await this.runFinalization({
            runId,
            context,
            runtime,
            modelSettings,
            settings,
            records,
            plan,
            executionStopReason:
              this.activeRun.stopReason,
            abortController
          });
          this.activeRun.phase = "checkpoint_ready";
          this.activeRun.activityStore?.finalize(
            this.activeRun.stopReason
          );
          break;
        }

        const segment = orchestrator.beginSegment({
          plan: toolSession.getPlan(),
          records: toolSession.getRecords()
        });

        if (!segment) {
          this.activeRun.stopReason =
            RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT;
          this.activeRun.executionStopReason =
            RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT;
          orchestrator.terminate(
            this.activeRun.stopReason
          );
          this.activeRun.phase = "checkpoint_ready";
          this.activeRun.activityStore?.recordProgress({
            title: "当前阶段进展已整理",
            status: "completed",
            stopReason: this.activeRun.stopReason
          });
          const records = toolSession.getRecords();
          const plan = toolSession.getPlan();
          this.activeRun.toolCalls = records;
          this.activeRun.executionStopReason =
            this.activeRun.stopReason;
          await this.runFinalization({
            runId,
            context,
            runtime,
            modelSettings,
            settings,
            records,
            plan,
            executionStopReason:
              this.activeRun.stopReason,
            abortController
          });
          this.activeRun.phase = "checkpoint_ready";
          this.activeRun.activityStore?.finalize(
            this.activeRun.stopReason
          );
          break;
        }

        this.activeRun.currentSegmentId = segment.id;
        this.activeRun.phase = "executing";
        this.persistActiveRunCheckpoint({ status: "running" });
        this.activeRun.activityStore?.recordProgress({
          title: segment.index === 1
            ? "开始执行任务" : "继续执行任务",
          status: "running"
        });

      const result =
        streamText({
          model: runtime.model,

          system:
            segmentSystem,

          messages:
            context.messages,

          tools:
            toolSession.tools,

          stopWhen:
            stepCountIs(
              maxSteps
            ),

          ...runtime.requestOptions,

          abortSignal:
            abortController.signal,

          timeout: {
            totalMs:
              Math.max(
                1,
                Math.min(modelSettings.timeoutMs, remainingRunMs)
              ),

            chunkMs:
              Math.min(
                45000,
                modelSettings
                  .timeoutMs
              )
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

            const compacted =
              compactRunStepContext({
                initialMessages,
                responseMessages,
                checkpoint:
                  this.buildActiveCheckpoint(),
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

          onStepStart: ({
            stepNumber
          }) => {
            if (
              !this.isCurrentRun(
                runId
              )
            ) {
              return;
            }

            this.activeRun
              .currentStepText =
              "";
            this.activeRun.stepNumber =
              Number(stepNumber) || 0;

            this.setStatus({
              ...this.status
            });
          },

          onStepEnd: (step) => {
            this.handleStepEnd(
              runId,
              step
            );
          },

          onError: ({
            error
          }) => {
            console.error(
              "模型流式请求错误：",
              error
            );
          }
        });

      for await (
        const textPart
        of result.textStream
      ) {
        if (
          !this.isCurrentRun(
            runId
          )
        ) {
          break;
        }

        if (textPart) {
          this.activeRun
            .currentStepText +=
            textPart;

          appendResponseChunk(
            textPart
          );

          this.setStatus({
            ...this.status
          });
        }
      }

      if (
        !abortController
          .signal
          .aborted &&
        this.isCurrentRun(runId)
      ) {
        const records =
          toolSession.getRecords();
        const finishReason =
          await settleResultValue(
            result.finishReason,
            "unknown"
          );
        const steps =
          await settleResultValue(
            result.steps,
            []
          );
        const plan =
          toolSession.getPlan();
        let executionStopReason =
          inferRunStopReason({
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
        const segmentCheckpoint =
          this.buildActiveCheckpoint();
        if (segmentCheckpoint) {
          segmentCheckpoint.orchestration = null;
        }
        const segmentOutcome =
          orchestrator.completeSegment({
            stopReason: executionStopReason,
            finishReason,
            plan,
            records,
            finalText: this.activeRun.finalText,
            checkpoint: segmentCheckpoint
          });

        this.activeRun.currentSegmentId = "";
        executionStopReason =
          segmentOutcome.stopReason;
        const segmentProgressTitle =
          segmentOutcome.decision === "continue"
            ? "已整理当前进展，继续执行"
            : segmentOutcome.decision === "checkpoint"
              ? "当前阶段进展已整理"
              : "当前阶段已完成";
        this.activeRun.activityStore?.recordProgress({
          title: segmentProgressTitle,
          status: ["continue", "complete", "checkpoint"].includes(segmentOutcome.decision)
            ? "completed" : "failed",
          stopReason: executionStopReason
        });

        if (segmentOutcome.decision === "continue") {
          this.activeRun.finalText = "";
          this.activeRun.currentStepText = "";
          this.activeRun.executionStopReason =
            executionStopReason;

          const continuationCheckpoint =
            this.buildActiveCheckpoint();
          this.activeRun.activityStore?.updateCheckpoint(
            continuationCheckpoint
          );
          segmentSystem = [
            context.system,
            createCheckpointInstruction(continuationCheckpoint),
            "[Continued execution] Continue the same task from the saved task state. Advance unfinished work; do not repeat completed tool calls. If required user input is missing, mark the current plan step needs_input and provide a final explanation. Do not mention internal execution slices or counters to the user."
          ].filter(Boolean).join("\n\n");
          this.persistActiveRunCheckpoint({ status: "running" });
          continue;
        }

        this.activeRun.toolCalls =
          records;
        this.activeRun
          .executionStopReason =
          executionStopReason;

        if (
          shouldRunFinalization({
            finalText:
              this.activeRun
                .finalText,
            plan,
            records,
            finishReason,
            stopReason:
              executionStopReason
          })
        ) {
          await this.runFinalization({
            runId,
            context,
            runtime,
            modelSettings,
            settings,
            records,
            plan,
            executionStopReason,
            abortController
          });
        }

        const planState =
          getPlanCompletionState(plan);
        const hasFinalText =
          Boolean(
            this.activeRun
              .finalText
              .trim()
          );

        const reachedContinuationBoundary =
          isGracefulRunBoundary(
            executionStopReason
          );

        this.activeRun.stopReason =
          reachedContinuationBoundary
            ? RUN_STOP_REASONS.AGENT_SEGMENT_LIMIT
            : hasFinalText &&
          (
            planState.isComplete ||
            executionStopReason === RUN_STOP_REASONS.COMPLETED
          )
            ? RUN_STOP_REASONS.COMPLETED
            : executionStopReason;
        this.activeRun.phase =
          reachedContinuationBoundary
            ? "checkpoint_ready"
            : this.activeRun.stopReason === RUN_STOP_REASONS.COMPLETED
            ? "completed"
            : this.activeRun.stopReason === RUN_STOP_REASONS.NEEDS_INPUT
              ? "needs_input"
              : this.activeRun.stopReason === RUN_STOP_REASONS.BLOCKED
                ? "blocked"
                : "failed";

        this.activeRun
          .activityStore
          ?.finalize(
            this.activeRun
              .stopReason
          );
      }
        break;
      }

      if (
        !abortController
          .signal
          .aborted &&
        !this.activeRun
          .finalText
          .trim()
      ) {
        const fallbackText =
          createFallbackFinalSummary({
            plan:
              this.activeRun.toolSession
                ?.getPlan?.() ??
              this.activeRun.initialPlan ?? [],
            records:
              this.activeRun.toolSession
                ?.getRecords?.() ??
              this.activeRun.toolCalls ?? [],
            executionStopReason:
              this.activeRun.executionStopReason ??
              this.activeRun.stopReason ??
              RUN_STOP_REASONS.COMPLETED
          }) || "当前处理已经结束，但没有生成完整说明。";

        this.activeRun
          .finalText =
          fallbackText;

        appendResponseChunk(
          fallbackText
        );
      }

      endResponseStream();

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

      if (
        this.isCurrentRun(
          runId
        )
      ) {
        let assistantText =
          this.activeRun
            .finalText
            .trim();

        if (!assistantText) {
          assistantText =
            "任务已处理完成。";
          this.activeRun.finalText =
            assistantText;
        }

        this.activeRun.activityStore
          ?.updateCheckpoint(
            this.buildActiveCheckpoint()
          );
        this.persistAssistantResponse({
          conversationId,
          content: assistantText,
          status: "complete"
        });

        const finalStopReason =
          this.activeRun
            .stopReason;

        this.activeRun = null;

        this.setStatus({
          state: "idle",
          runId: null,
          conversationId,
          startedAt: null,
          lastError: null,
          stopReason:
            finalStopReason
        });
      }
    } catch (error) {
      if (
        abortController
          .signal
          .aborted ||
        isAbortError(error)
      ) {
        endResponseStream();
        this.finishCancelledRun({
          runId,
          conversationId
        });
        return;
      }

      const friendlyMessage =
        formatAgentError(error);

      console.error(
        "Agent 运行失败：",
        error
      );

      if (
        this.isCurrentRun(
          runId
        )
      ) {
        const records =
          this.activeRun.toolSession
            ?.getRecords?.() ??
          this.activeRun.toolCalls ?? [];
        const plan =
          this.activeRun.toolSession
            ?.getPlan?.() ??
          this.activeRun.initialPlan ?? [];
        const hasRecoverableState =
          records.some((record) =>
            record?.status === "completed"
          ) ||
          plan.length > 0;

        this.activeRun.stopReason =
          hasRecoverableState
            ? RUN_STOP_REASONS.MODEL_RECOVERY
            : RUN_STOP_REASONS.MODEL_ERROR;
        this.activeRun.executionStopReason =
          this.activeRun.stopReason;
        this.activeRun.orchestrator?.terminate(
          this.activeRun.stopReason
        );

        if (hasRecoverableState) {
          this.activeRun.phase = "checkpoint_ready";
          this.activeRun.toolCalls = records;
          this.activeRun.activityStore?.recordProgress({
            title: "当前进展已整理",
            status: "completed",
            stopReason: this.activeRun.stopReason
          });
          this.activeRun.finalText =
            createFallbackFinalSummary({
              plan,
              records,
              executionStopReason:
                this.activeRun.stopReason
            });

          startResponseStream();
          appendResponseChunk(
            this.activeRun.finalText
          );
          endResponseStream();

          this.activeRun.activityStore?.finalize(
            this.activeRun.stopReason
          );
          this.activeRun.activityStore
            ?.updateCheckpoint(
              this.buildActiveCheckpoint()
            );
          this.persistAssistantResponse({
            conversationId,
            content:
              this.activeRun.finalText,
            status: "complete"
          });

          const finalStopReason =
            this.activeRun.stopReason;
          this.activeRun = null;
          this.setStatus({
            state: "idle",
            runId: null,
            conversationId,
            startedAt: null,
            lastError: null,
            stopReason: finalStopReason
          });
          return;
        }

        startResponseStream();
        appendResponseChunk(
          `⚠ ${friendlyMessage}`
        );
        endResponseStream();

        this.activeRun.phase = "failed";
        this.activeRun
          .activityStore
          ?.finalize(
            this.activeRun
              .stopReason
          );
        this.activeRun.finalText =
          `⚠ ${friendlyMessage}`;
        this.activeRun.activityStore
          ?.updateCheckpoint(
            this.buildActiveCheckpoint()
          );
        this.persistAssistantResponse({
          conversationId,
          content:
            this.activeRun
              .finalText,
          status: "complete"
        });

        this.activeRun = null;

        this.setStatus({
          state: "error",
          runId: null,
          conversationId,
          startedAt: null,
          lastError:
            friendlyMessage,
          stopReason:
            RUN_STOP_REASONS
              .MODEL_ERROR
        });
      }
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
