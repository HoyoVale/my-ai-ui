import {
  BrowserWindow
} from "electron";

import {
  generateText,
  hasToolCall,
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

function formatPendingQuestion(
  request
) {
  if (!request?.question) {
    return "";
  }

  const lines = [
    request.question
  ];

  if (request.reason) {
    lines.push(
      "",
      `需要确认的原因：${request.reason}`
    );
  }

  if (
    Array.isArray(
      request.options
    ) &&
    request.options.length > 0
  ) {
    lines.push(
      "",
      ...request.options.map(
        (option, index) =>
          `${index + 1}. ${option.label}`
      )
    );
  }

  return lines.join("\n");
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
      plan:
        this.activeRun
          ?.toolSession
          ?.getPlan?.() ?? [],
      activeToolCalls:
        this.activeRun
          ?.toolSession
          ?.getRecords?.() ?? []
    });
  }

  startMessage(content) {
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

    const abortController =
      new AbortController();

    const startedAt =
      Date.now();

    this.activeRun = {
      runId,
      conversationId:
        conversation.id,
      abortController,
      assistantText: "",
      startedAt,
      replaceMessageId: null,
      reasoningSummary: "",
      toolCalls: []
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

    const abortController =
      new AbortController();

    const startedAt =
      Date.now();

    this.activeRun = {
      runId,
      conversationId:
        plan.conversation.id,
      abortController,
      assistantText: "",
      startedAt,
      replaceMessageId:
        plan.targetMessage.id,
      reasoningSummary: "",
      toolCalls: []
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
        getSettings().tools
          ?.runtime
          ?.saveToolHistory === false
          ? []
          : this.activeRun
              .toolCalls
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
            .assistantText +=
            textPart;

          appendResponseChunk(
            textPart
          );
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
          .assistantText
          .trim();

      if (assistantText) {
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

  async runMessage({
    runId,
    conversationId,
    context,
    abortController
  }) {
    let receivedText = false;

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
          settings
        });

      this.activeRun.toolSession =
        toolSession;

      startResponseStream();

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
              settings.tools
                ?.runtime
                ?.maxSteps ??
              6
            ),
            hasToolCall(
              "ask_user"
            )
          ],

          ...runtime.requestOptions,

          abortSignal:
            abortController.signal,

          timeout: {
            totalMs:
              modelSettings
                .timeoutMs,

            chunkMs:
              Math.min(
                45000,
                modelSettings
                  .timeoutMs
              )
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
          receivedText = true;

          this.activeRun
            .assistantText +=
            textPart;

          appendResponseChunk(
            textPart
          );
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

        this.activeRun.toolCalls =
          toolSession.getRecords();
      }

      if (
        !abortController
          .signal
          .aborted &&
        !receivedText
      ) {
        const pendingQuestion =
          formatPendingQuestion(
            toolSession
              .getPendingQuestion()
          );

        const fallbackText =
          pendingQuestion ||
          "模型没有返回可显示的文字。";

        this.activeRun
          .assistantText =
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
              .assistantText
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
        const assistantText =
          this.activeRun
            .assistantText
            .trim();

        if (assistantText) {
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
              .assistantText
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
        this.activeRun = null;

        this.setStatus({
          state: "error",
          runId: null,
          conversationId,
          startedAt: null,
          lastError:
            friendlyMessage
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
