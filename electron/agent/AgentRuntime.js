import {
  BrowserWindow
} from "electron";

import {
  generateText,
  stepCountIs,
  streamText
} from "ai";

import crypto from "node:crypto";

import IPC_CHANNELS
  from "../shared/ipcChannels.cjs";

import {
  conversationManager
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
  RUN_STOP_REASONS
} from "./runStopReasons.js";

import {
  classifyAgentStep
} from "./stepText.js";

import {
  createFallbackFinalSummary,
  createFinalizationInstruction,
  getPlanCompletionState,
  shouldRunFinalization
} from "./finalization.js";

import {
  collectAnsweredQuestions,
  countQuestionEvents
} from "../tools/agent/askUserPolicy.js";




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

function createResumeInstruction(
  pending,
  answer = ""
) {
  if (!pending?.request?.question) {
    return "";
  }

  return [
    "[Resumed Agent Task]",
    "The user answered the clarification checkpoint inside the current assistant run.",
    `Previous question: ${pending.request.question}`,
    `User answer: ${String(answer ?? "").trim()}`,
    pending.request.decisionKey
      ? `Resolved decision key: ${pending.request.decisionKey}`
      : "",
    "Continue the same task and the same plan. Do not greet the user or treat this as a new conversation turn.",
    "This checkpoint is answered. Do not call ask_user again for the same decision.",
    "Your next action must advance the plan, use a non-question tool, or provide the final answer. Only ask another question if a genuinely new blocking ambiguity appears later."
  ].filter(Boolean).join("\n");
}

function createAnsweredQuestion(
  pending,
  {
    answer = "",
    selectedOptionIds = [],
    otherText = ""
  } = {}
) {
  return {
    ...structuredClone(
      pending?.request ?? {}
    ),
    status: "answered",
    answer:
      String(answer ?? "").trim(),
    selectedOptionIds:
      Array.isArray(selectedOptionIds)
        ? selectedOptionIds.map(String)
        : [],
    otherText:
      String(otherText ?? "").trim(),
    answeredAt: Date.now()
  };
}

function appendResumeAnswerToContext(
  context,
  pending,
  answeredQuestion
) {
  const answer =
    answeredQuestion?.answer ?? "";
  const resumeInstruction =
    createResumeInstruction(
      pending,
      answer
    );

  context.system = [
    context.system,
    resumeInstruction
  ].filter(Boolean).join("\n\n");

  context.metadata = {
    ...context.metadata,
    resumedMessageId:
      pending.messageId,
    resumedRunId:
      pending.activity?.runId ?? ""
  };

  return context;
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
    let status = this.status;
    let pendingQuestion =
      this.activeRun
        ?.pendingQuestion ??
      null;

    if (
      !this.activeRun &&
      status.state === "idle"
    ) {
      const state =
        conversationManager
          .getState();
      const pending =
        state.currentConversationId
          ? conversationManager
              .getPendingQuestion(
                state.currentConversationId
              )
          : null;

      if (pending) {
        status = {
          ...status,
          state:
            "waiting_for_user",
          conversationId:
            state.currentConversationId
        };
        pendingQuestion =
          pending.request;
      }
    }

    return cloneStatus({
      ...status,
      pendingQuestion,
      stopReason:
        this.activeRun
          ?.stopReason ??
        status.stopReason ??
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
          ?.finalizationAttemptCount ?? 0
    });
  }

  startMessage(
    content,
    {
      expectedConversationId = "",
      expectedPendingMessageId = ""
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

      const pendingQuestion =
        conversationManager
          .getPendingQuestion(
            conversation.id
          );

      if (pendingQuestion) {
        return {
          ok: false,
          code: "pending-question-active",
          message:
            "请先在当前回复中回答待确认问题。"
        };
      }

      if (expectedPendingMessageId) {
        return {
          ok: false,
          code: "question-expired",
          message:
            "这个问题已经失效或被回答，请刷新会话。"
        };
      }

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
      taskId,
      conversationId:
        conversation.id,
      abortController,
      currentStepText: "",
      finalText: "",
      stepNumber: 0,
      startedAt,
      replaceMessageId: null,
      reasoningSummary: "",
      toolCalls: [],
      activityStore,
      initialPlan: [],
      resumedFromMessageId: "",
      pendingQuestion: null,
      answeredQuestion: null,
      answeredQuestions: [],
      initialQuestionCount: 0,
      resumeInPlace: false,
      phase: "executing",
      finalizationAttemptCount: 0,
      executionStopReason: null,
      stopReason: null
    };

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
      conversationId:
        conversation.id
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
      reasoningSummary: "",
      toolCalls: [],
      activityStore,
      initialPlan: [],
      resumedFromMessageId: "",
      pendingQuestion: null,
      answeredQuestion: null,
      answeredQuestions: [],
      initialQuestionCount: 0,
      resumeInPlace: false,
      phase: "executing",
      finalizationAttemptCount: 0,
      executionStopReason: null,
      stopReason: null
    };

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
      reasoningSummary:
        this.activeRun
          .reasoningSummary,
      toolCalls:
        saveToolHistory
          ? this.activeRun
              .toolCalls
          : [],
      plan:
        this.activeRun
          .toolSession
          ?.getPlan?.() ?? [],
      stopReason:
        this.activeRun
          .stopReason ??
        (status === "aborted"
          ? RUN_STOP_REASONS
              .CANCELLED_BY_USER
          : RUN_STOP_REASONS
              .COMPLETED),
      pendingQuestion:
        this.activeRun
          .pendingQuestion ??
        this.activeRun
          .answeredQuestion ??
        null,
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

  resumeQuestion({
    conversationId,
    messageId,
    answer,
    selectedOptionIds = [],
    otherText = ""
  } = {}) {
    const normalizedConversationId =
      String(conversationId ?? "").trim();
    const normalizedMessageId =
      String(messageId ?? "").trim();
    const normalizedAnswer =
      String(answer ?? "").trim();

    if (!normalizedAnswer) {
      return {
        ok: false,
        code: "empty-answer",
        message: "请选择或输入一个回答。"
      };
    }

    if (this.activeRun) {
      return {
        ok: false,
        code: "busy",
        message:
          "当前回复尚未结束，请稍后再提交。"
      };
    }

    const pending =
      conversationManager
        .getPendingQuestion(
          normalizedConversationId
        );

    if (
      !pending ||
      pending.messageId !==
        normalizedMessageId
    ) {
      return {
        ok: false,
        code: "question-expired",
        message:
          "这个问题已经失效或被回答，请刷新会话。"
      };
    }

    const normalizedSelectedOptionIds =
      Array.isArray(selectedOptionIds)
        ? selectedOptionIds.map(String)
        : [];
    const allowedOptionIds =
      new Set(
        (pending.request?.options ?? [])
          .map((option) =>
            String(option.id)
          )
      );
    const invalidSelection =
      normalizedSelectedOptionIds.some(
        (id) =>
          !allowedOptionIds.has(
            String(id)
          )
      );

    if (invalidSelection) {
      return {
        ok: false,
        code: "invalid-answer-option",
        message:
          "所选选项已经发生变化，请重新选择。"
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

    try {
      const answeredQuestion =
        createAnsweredQuestion(
          pending,
          {
            answer:
              normalizedAnswer,
            selectedOptionIds:
              normalizedSelectedOptionIds,
            otherText
          }
        );

      const resolved =
        conversationManager
          .resolvePendingQuestion({
            conversationId:
              normalizedConversationId,
            messageId:
              normalizedMessageId,
            answer:
              normalizedAnswer,
            selectedOptionIds:
              normalizedSelectedOptionIds,
            otherText
          });

      if (!resolved.ok) {
        return resolved;
      }

      const conversation =
        conversationManager
          .getConversation(
            normalizedConversationId
          );
      const memories =
        memoryManager.retrieve({
          query: normalizedAnswer
        });
      const context =
        appendResumeAnswerToContext(
          assembleAgentContext({
            settings:
              getSettings(),
            conversation,
            memories
          }),
          pending,
          answeredQuestion
        );
      const runId =
        pending.activity?.runId ??
        crypto.randomUUID();
      const taskId =
        pending.taskId ??
        pending.activity?.taskId ??
        runId;
      const startedAt =
        pending.activity?.startedAt ??
        Date.now();
      const abortController =
        new AbortController();
      const activityStore =
        RunActivityStore
          .resumeFromSnapshot(
            pending.activity,
            {
              answeredQuestion,
              runId,
              taskId
            }
          );

      this.activeRun = {
        runId,
        taskId,
        conversationId:
          normalizedConversationId,
        abortController,
        currentStepText: "",
        finalText: "",
        stepNumber: 0,
        startedAt,
        replaceMessageId:
          normalizedMessageId,
        resumeInPlace: true,
        reasoningSummary: "",
        toolCalls: [],
        activityStore,
        initialPlan:
          pending.plan ?? [],
        resumedFromMessageId:
          normalizedMessageId,
        pendingQuestion: null,
        answeredQuestion,
        answeredQuestions: [
          ...collectAnsweredQuestions(
            pending.activity
          ),
          answeredQuestion
        ],
        initialQuestionCount:
          Math.max(
            countQuestionEvents(
              pending.activity
            ),
            1
          ),
        phase: "executing",
        finalizationAttemptCount: 0,
        executionStopReason: null,
        stopReason: null
      };

      this.setStatus({
        state: "running",
        runId,
        conversationId:
          normalizedConversationId,
        startedAt,
        lastError: null
      });

      const runArguments = {
        runId,
        conversationId:
          normalizedConversationId,
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
          normalizedConversationId,
        messageId:
          normalizedMessageId,
        resumedInPlace: true
      };
    } catch (error) {
      console.error(
        "恢复待确认任务失败：",
        error
      );

      return {
        ok: false,
        code: "resume-failed",
        message:
          "无法继续当前任务，请稍后重试。"
      };
    }
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

    this.setStatus({
      ...this.status,
      state: "stopping"
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
        if (
          this.isCurrentRun(
            runId
          )
        ) {
          this.activeRun = null;

          this.setStatus({
            state: "idle",
            runId: null,
            conversationId,
            startedAt: null,
            lastError: null
          });
        }

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
        executionStopReason,
        answeredQuestion:
          this.activeRun
            .answeredQuestion
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

      let text = "";

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

      const normalized =
        text.trim();

      if (normalized) {
        this.activeRun.finalText =
          normalized;
        this.activeRun
          .currentStepText =
          "";
        this.activeRun.phase =
          "completed";

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
          onPlanChange: (plan) => {
            if (
              this.isCurrentRun(
                runId
              )
            ) {
              this.activeRun
                .activityStore
                ?.recordPlan(plan);
              this.setStatus({
                ...this.status
              });
            }
          },
          onQuestion: (question) => {
            if (
              this.isCurrentRun(
                runId
              )
            ) {
              this.activeRun
                .activityStore
                ?.recordQuestion(
                  question
                );
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
          answeredQuestions:
            this.activeRun
              .answeredQuestions ?? [],
          initialQuestionCount:
            this.activeRun
              .initialQuestionCount ?? 0
        });

      this.activeRun.toolSession =
        toolSession;

      startResponseStream();

      const maxSteps =
        settings.tools
          ?.runtime
          ?.maxSteps ?? 6;

      const result =
        streamText({
          model: runtime.model,

          system:
            context.system,

          messages:
            context.messages,

          tools:
            toolSession.tools,

          stopWhen: [
            stepCountIs(
              maxSteps
            ),
            () => Boolean(
              toolSession
                .getPendingQuestion()
            )
          ],

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
                modelSettings
                  .timeoutMs
              )
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
        const reasoningText =
          await result.reasoningText;

        this.activeRun
          .reasoningSummary =
          String(
            reasoningText ?? ""
          ).trim();

        this.activeRun
          .activityStore
          ?.recordSummary(
            this.activeRun
              .reasoningSummary
          );

        const records =
          toolSession.getRecords();
        const pendingQuestion =
          toolSession
            .getPendingQuestion();
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
        const executionStopReason =
          inferRunStopReason({
            pendingQuestion,
            records,
            finishReason,
            steps,
            maxSteps,
            plan
          });

        this.activeRun.toolCalls =
          records;
        this.activeRun.pendingQuestion =
          pendingQuestion
            ? {
                ...pendingQuestion,
                status: "waiting"
              }
            : null;
        this.activeRun
          .executionStopReason =
          executionStopReason;

        if (
          shouldRunFinalization({
            pendingQuestion,
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

        this.activeRun.stopReason =
          pendingQuestion
            ? RUN_STOP_REASONS
                .WAITING_FOR_USER
            : hasFinalText &&
              (
                planState.isComplete ||
                executionStopReason ===
                  RUN_STOP_REASONS
                    .COMPLETED
              )
              ? RUN_STOP_REASONS
                  .COMPLETED
              : executionStopReason;

        this.activeRun
          .activityStore
          ?.finalize(
            this.activeRun
              .stopReason
          );
      }

      if (
        !abortController
          .signal
          .aborted &&
        !this.activeRun
          .finalText
          .trim() &&
        !this.activeRun
          .pendingQuestion
      ) {
        const fallbackText =
          "模型没有返回可显示的文字。";

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
        if (
          this.isCurrentRun(
            runId
          )
        ) {
          const assistantText =
            this.activeRun
              .finalText
              .trim();

          const shouldSave =
            getSettings()
              .conversation
              .saveAbortedReplies;

          if (
            shouldSave &&
            assistantText &&
            !this.activeRun
              .replaceMessageId
          ) {
            this.activeRun.stopReason =
              RUN_STOP_REASONS
                .CANCELLED_BY_USER;
            this.activeRun
              .activityStore
              ?.finalize(
                this.activeRun
                  .stopReason
              );
            this.persistAssistantResponse({
              conversationId,
              content:
                assistantText,
              status: "aborted"
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
        }

        return;
      }

      if (
        this.isCurrentRun(
          runId
        )
      ) {
        const waitingQuestion =
          this.activeRun
            .pendingQuestion;
        let assistantText =
          this.activeRun
            .finalText
            .trim();

        if (
          !assistantText &&
          !waitingQuestion
        ) {
          assistantText =
            "任务已处理完成。";
          this.activeRun.finalText =
            assistantText;
        }

        if (
          assistantText ||
          waitingQuestion
        ) {
          this.persistAssistantResponse({
            conversationId,
            content:
              assistantText,
            status: "complete"
          });
        }

        const finalStopReason =
          this.activeRun
            .stopReason;

        this.activeRun = null;

        this.setStatus({
          state:
            waitingQuestion
              ? "waiting_for_user"
              : "idle",
          runId: null,
          conversationId,
          startedAt: null,
          lastError: null,
          pendingQuestion:
            waitingQuestion,
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

        if (
          this.isCurrentRun(
            runId
          )
        ) {
          const assistantText =
            this.activeRun
              .finalText
              .trim();

          const shouldSave =
            getSettings()
              .conversation
              .saveAbortedReplies;

          if (
            shouldSave &&
            assistantText &&
            !this.activeRun
              .replaceMessageId
          ) {
            this.activeRun.stopReason =
              RUN_STOP_REASONS
                .CANCELLED_BY_USER;
            this.activeRun
              .activityStore
              ?.finalize(
                this.activeRun
                  .stopReason
              );
            this.persistAssistantResponse({
              conversationId,
              content:
                assistantText,
              status: "aborted"
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
        }

        return;
      }

      const friendlyMessage =
        formatAgentError(error);

      console.error(
        "Agent 运行失败：",
        error
      );

      startResponseStream();
      appendResponseChunk(
        `⚠ ${friendlyMessage}`
      );
      endResponseStream();

      if (
        this.isCurrentRun(
          runId
        )
      ) {
        this.activeRun.stopReason =
          RUN_STOP_REASONS
            .MODEL_ERROR;
        this.activeRun
          .activityStore
          ?.finalize(
            this.activeRun
              .stopReason
          );
        this.activeRun.finalText =
          `⚠ ${friendlyMessage}`;
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
