import {
  BrowserWindow
} from "electron";

import {
  generateText,
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
  buildMemoryContext
} from "../memory/memoryContextBuilder.js";

import {
  sanitizeSettings
} from "../settings/validateSettings.js";

import {
  appendResponseChunk,
  endResponseStream,
  startResponseStream
} from "../windows/response/index.js";

import {
  createConfiguredModel
} from "./modelFactory.js";

import {
  getModelApiKey
} from "./credentialStore.js";

import {
  formatAgentError,
  isAbortError
} from "./agentErrors.js";

import {
  isE2EMode,
  streamE2EResponse
} from "./e2eAgentDriver.js";

const DEFAULT_SYSTEM_PROMPT = `
你是 Xixi，一个运行在用户桌面上的轻量 AI 助手。
请使用用户当前使用的语言回答。
回答应当清晰、自然、直接；除非用户要求，否则不要写得过长。
当前阶段你只负责普通对话，不调用工具，也不声称自己完成了尚未执行的操作。
`.trim();

function cloneStatus(status) {
  return {
    ...status
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

  getStatus() {
    return cloneStatus(
      this.status
    );
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

    if (
      !isE2EMode() &&
      !getModelApiKey()
    ) {
      const errorMessage =
        "尚未配置 DeepSeek API Key。请先在 Setting → Model 中保存密钥。";

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
    let messages;
    let memories;

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

      messages =
        conversationManager
          .buildContext(
            conversation.id
          );

      memories =
        memoryManager.retrieve({
          query: message
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

    this.activeRun = {
      runId,
      conversationId:
        conversation.id,
      abortController,
      assistantText: ""
    };

    this.setStatus({
      state: "running",
      runId,
      conversationId:
        conversation.id,
      startedAt:
        Date.now(),
      lastError: null
    });

    const runArguments = {
      runId,
      conversationId:
        conversation.id,
      messages,
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

    const modelSettings =
      sanitizeSettings({
        ...settings,

        model: {
          ...settings.model,
          ...modelOverride
        }
      }).model;

    const startedAt =
      Date.now();

    try {
      const result =
        await generateText({
          model:
            createConfiguredModel(
              modelSettings
            ),

          system:
            DEFAULT_SYSTEM_PROMPT,

          prompt:
            "只回复：连接成功",

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
    messages,
    memories,
    abortController
  }) {
    try {
      startResponseStream();

      await streamE2EResponse({
        messages,
        memories,
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
        conversationManager
          .appendMessage({
            conversationId,
            role: "assistant",
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
    messages,
    memories,
    abortController
  }) {
    let receivedText = false;

    try {
      const settings =
        getSettings();

      const modelSettings =
        settings.model;

      const model =
        createConfiguredModel(
          modelSettings
        );

      const memoryContext =
        buildMemoryContext(
          memories
        );

      const systemPrompt =
        [
          DEFAULT_SYSTEM_PROMPT,
          memoryContext
        ]
          .filter(Boolean)
          .join("\n\n");

      startResponseStream();

      const result =
        streamText({
          model,

          system:
            systemPrompt,

          messages,

          temperature:
            modelSettings
              .temperature,

          maxOutputTokens:
            modelSettings
              .maxOutputTokens,

          maxRetries: 1,

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
        !receivedText
      ) {
        const fallbackText =
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
            assistantText
          ) {
            conversationManager
              .appendMessage({
                conversationId,
                role:
                  "assistant",
                content:
                  assistantText,
                status:
                  "aborted"
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
          conversationManager
            .appendMessage({
              conversationId,
              role: "assistant",
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
            assistantText
          ) {
            conversationManager
              .appendMessage({
                conversationId,
                role:
                  "assistant",
                content:
                  assistantText,
                status:
                  "aborted"
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
