import crypto from "node:crypto";

import {
  conversationManager
} from "../../conversation/index.js";

import {
  resolveConversationExecutionContext
} from "../../conversation/executionContext.js";

import {
  getSettings
} from "../../settings/settingsStore.js";

import {
  memoryManager
} from "../../memory/index.js";

import {
  assembleAgentContext
} from "../../context/index.js";

import {
  appendResponseChunk,
  endResponseStream,
  startResponseStream
} from "../../windows/response/index.js";

import {
  getConversationTargetError
} from "../messageTarget.js";

import {
  isE2EMode
} from "../e2eAgentDriver.js";

import {
  parseSkillCommand,
  resolveSkillRuntime,
  skillRegistry
} from "../../skills/index.js";

import {
  RunActivityStore
} from "../RunActivityStore.js";

import {
  RunDiffTracker
} from "../RunDiffTracker.js";

import {
  TokenLedger
} from "../TokenLedger.js";

import {
  createCoreLiteContinuationState,
  resolveCoreLiteCheckpointContinuation
} from "../CoreLiteCheckpointResume.js";

import {
  appendTaskContinuationToContext,
  getActiveCredentialError
} from "../AgentRuntimeInternals.js";

import {
  AgentRunSession
} from "../AgentRunSession.js";

function createSession({
  runId,
  taskId,
  conversation,
  objective,
  continuationState,
  skillRuntime,
  activeWorkspace,
  runSettings,
  context,
  replaceMessageId = null,
  resumeInPlace = false
}) {
  const abortController = new AbortController();
  const startedAt = Date.now();
  const activityStore = new RunActivityStore({
    taskId,
    runId,
    startedAt
  });

  return new AgentRunSession({
    runId,
    taskId,
    conversationId: conversation.id,
    objective,
    parentRunId:
      continuationState?.parentRunId ?? "",
    resumedFromMessageId:
      continuationState?.resumedFromMessageId ?? "",
    continuationCount:
      continuationState?.continuationCount ?? 0,
    workspaceId:
      conversation.workspaceId ?? null,
    workspaceSnapshot:
      conversation.workspaceSnapshot ?? null,
    mode: conversation.mode ?? "chat",
    modelSelection:
      conversation.modelSelection ?? null,
    modelSnapshot:
      conversation.modelSnapshot ?? null,
    skillRuntime,
    activeWorkspace,
    runtimePreferences: {
      saveAbortedReplies:
        runSettings.conversation?.saveAbortedReplies !== false,
      saveToolHistory:
        runSettings.tools?.runtime?.saveToolHistory !== false
    },
    abortController,
    activityStore,
    diffTracker: new RunDiffTracker({
      runId,
      workspaceId: conversation.workspaceId ?? ""
    }),
    tokenLedger: new TokenLedger({
      runId,
      taskId,
      providerId:
        context.metadata?.activeModel?.providerId ?? "",
      modelId:
        context.metadata?.activeModel?.modelId ?? "",
      context
    }),
    replaceMessageId,
    resumeInPlace,
    startedAt,
    contextCompactionCount:
      continuationState?.contextCompactionCount ?? 0
  });
}

function recordActiveSkill(session) {
  if (!session.skillRuntime?.active) {
    return;
  }

  session.activityStore?.recordSkill({
    skill: session.skillRuntime.skill,
    skills: session.skillRuntime.skills,
    source: session.skillRuntime.source,
    router: session.skillRuntime.router,
    status: "running"
  });
}

function launchRun(runtime, {
  context,
  memories,
  settings
}) {
  const runArguments = {
    runId: runtime.activeRun.runId,
    conversationId: runtime.activeRun.conversationId,
    context,
    memories,
    settings,
    abortController: runtime.activeRun.abortController
  };

  if (isE2EMode()) {
    void runtime.runE2EMessage(runArguments);
  } else {
    void runtime.runMessage(runArguments);
  }
}

export const agentRunPreparation = {
  startMessage(
    content,
    {
      expectedConversationId = "",
      continueTask = false,
      threadCommand: _threadCommand = ""
    } = {}
  ) {
    const message = String(content ?? "").trim();

    if (!message) {
      return {
        ok: false,
        code: "empty-message",
        message: "消息不能为空。"
      };
    }

    const initialConversation =
      conversationManager.getCurrentConversation();

    if (this.activeRun) {
      return {
        ok: false,
        code: "busy",
        message: "当前回复尚未结束，请先停止生成。"
      };
    }

    const initialTargetError = getConversationTargetError(
      initialConversation,
      expectedConversationId
    );
    if (initialTargetError) {
      return initialTargetError;
    }

    const credentialBinding =
      resolveConversationExecutionContext({
        settings: getSettings(),
        conversation: initialConversation
      });
    const credentialError = isE2EMode()
      ? null
      : getActiveCredentialError(
          credentialBinding.settings.model
        );

    if (credentialError) {
      startResponseStream();
      appendResponseChunk(`⚠ ${credentialError}`);
      endResponseStream();
      this.setStatus({
        state: "error",
        runId: null,
        conversationId: null,
        startedAt: null,
        lastError: credentialError
      });
      return {
        ok: false,
        code: "missing-api-key",
        message: credentialError
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

    try {
      conversation =
        conversationManager.getCurrentConversation();
      const targetError = getConversationTargetError(
        conversation,
        expectedConversationId
      );
      if (targetError) {
        return targetError;
      }

      checkpointContinuation = resolveCoreLiteCheckpointContinuation({
        conversation,
        message,
        explicit: continueTask === true
      });
      continuationState = createCoreLiteContinuationState(
        checkpointContinuation
      );

      let skillCommand = null;
      if (!continuationState) {
        const runtimeSkills = skillRegistry
          .getRuntimeState({ mode: conversation.mode })
          .skills;
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
      const boundSkillIds =
        preparedExecution.conversation.skillIds ??
        (preparedExecution.conversation.skillId
          ? [preparedExecution.conversation.skillId]
          : []);

      skillRuntime = resolveSkillRuntime({
        registry: skillRegistry,
        skillId: preparedExecution.conversation.skillId,
        skillIds: skillCommand?.matched
          ? skillCommand.skillIds
          : boundSkillIds,
        mode: preparedExecution.metadata.mode,
        expectedSnapshot:
          preparedExecution.conversation.skillSnapshot,
        expectedSnapshots: skillCommand?.matched
          ? null
          : preparedExecution.conversation.skillSnapshots ??
            (preparedExecution.conversation.skillSnapshot
              ? [preparedExecution.conversation.skillSnapshot]
              : []),
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

      conversationManager.appendMessage({
        conversationId: conversation.id,
        role: "user",
        content: runMessage
      });
      conversation = conversationManager.getConversation(
        conversation.id
      );

      memories = memoryManager.retrieve({
        query: runMessage
      });

      const execution = resolveConversationExecutionContext({
        settings: settingsSnapshot,
        conversation,
        overrides: continuationState ?? {}
      });
      executionConversation = execution.conversation;
      runSettings = execution.settings;
      activeWorkspace = execution.workspace;

      context = assembleAgentContext({
        settings: runSettings,
        conversation: executionConversation,
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
      appendResponseChunk(`⚠ ${errorMessage}`);
      endResponseStream();
      return {
        ok: false,
        code: "conversation-write-failed",
        message: errorMessage
      };
    }

    const runId = crypto.randomUUID();
    const taskId =
      continuationState?.taskId || crypto.randomUUID();

    this.activeRun = createSession({
      runId,
      taskId,
      conversation: executionConversation,
      objective:
        continuationState?.objective || runMessage,
      continuationState,
      skillRuntime,
      activeWorkspace,
      runSettings,
      context
    });

    recordActiveSkill(this.activeRun);
    this.ensureActiveAssistantMessage(
      this.activeRun.conversationId
    );
    this.setStatus({
      state: "running",
      runId,
      conversationId: this.activeRun.conversationId,
      startedAt: this.activeRun.startedAt,
      lastError: null
    });
    launchRun(this, {
      context,
      memories,
      settings: runSettings
    });

    return {
      ok: true,
      runId,
      taskId,
      conversationId: this.activeRun.conversationId,
      continuedTask: Boolean(continuationState),
      resumedFromMessageId:
        continuationState?.resumedFromMessageId ?? ""
    };
  },

  regenerateMessage({
    conversationId,
    messageId
  } = {}) {
    if (this.activeRun) {
      return {
        ok: false,
        code: "busy",
        message: "当前回复尚未结束，请先停止生成。"
      };
    }

    let regeneration;
    let memories;
    let context;
    let runSettings;
    let activeWorkspace = null;
    let skillRuntime = null;

    try {
      regeneration = conversationManager.prepareRegeneration({
        conversationId: String(conversationId ?? ""),
        messageId: String(messageId ?? "")
      });
      if (!regeneration.ok) {
        return regeneration;
      }

      const execution = resolveConversationExecutionContext({
        settings: getSettings(),
        conversation: regeneration.conversation
      });
      const credentialError = isE2EMode()
        ? null
        : getActiveCredentialError(execution.settings.model);
      if (credentialError) {
        return {
          ok: false,
          code: "missing-api-key",
          message: credentialError
        };
      }

      const previousSkillRun =
        regeneration.targetMessage?.skillRun ?? null;
      const regenerationSkillIds =
        previousSkillRun?.rootSkillIds?.length
          ? previousSkillRun.rootSkillIds
          : regeneration.conversation.skillIds ??
            (regeneration.conversation.skillId
              ? [regeneration.conversation.skillId]
              : []);
      const regenerationSkillSnapshots =
        previousSkillRun?.skills?.length
          ? previousSkillRun.skills
          : regeneration.conversation.skillSnapshots ??
            (regeneration.conversation.skillSnapshot
              ? [regeneration.conversation.skillSnapshot]
              : []);

      skillRuntime = resolveSkillRuntime({
        registry: skillRegistry,
        skillId:
          previousSkillRun?.id ?? regeneration.conversation.skillId,
        skillIds: regenerationSkillIds,
        mode: regeneration.conversation.mode,
        expectedSnapshot:
          regeneration.conversation.skillSnapshot,
        expectedSnapshots: regenerationSkillSnapshots,
        routingMode:
          previousSkillRun?.routingMode ??
          regeneration.conversation.skillRoutingMode,
        routeMessage: regeneration.userMessage.content,
        source: previousSkillRun?.source ?? "manual",
        routerSnapshot: previousSkillRun?.router ?? null
      });
      if (!skillRuntime.ok) {
        return skillRuntime;
      }

      memories = memoryManager.retrieve({
        query: regeneration.userMessage.content
      });
      runSettings = execution.settings;
      activeWorkspace = execution.workspace;
      context = assembleAgentContext({
        settings: runSettings,
        conversation: regeneration.conversation,
        memories,
        skillRuntime
      });
      context.metadata = {
        ...context.metadata,
        regeneration: true
      };
    } catch (error) {
      console.error("准备重新生成失败：", error);
      return {
        ok: false,
        code: "regeneration-prepare-failed",
        message: "无法准备重新生成。"
      };
    }

    const runId = crypto.randomUUID();
    const taskId = String(
      regeneration.targetMessage?.taskId ?? ""
    ).trim() || crypto.randomUUID();
    const continuationState = {
      parentRunId: String(
        regeneration.targetMessage?.activity?.runId ??
        regeneration.targetMessage?.runId ??
        ""
      ),
      continuationCount: 0,
      contextCompactionCount: 0,
      resumedFromMessageId: ""
    };

    this.activeRun = createSession({
      runId,
      taskId,
      conversation: regeneration.conversation,
      objective: regeneration.userMessage.content,
      continuationState,
      skillRuntime,
      activeWorkspace,
      runSettings,
      context,
      replaceMessageId: regeneration.targetMessage.id,
      resumeInPlace: false
    });

    recordActiveSkill(this.activeRun);
    this.ensureActiveAssistantMessage(
      this.activeRun.conversationId
    );
    this.setStatus({
      state: "running",
      runId,
      conversationId: this.activeRun.conversationId,
      startedAt: this.activeRun.startedAt,
      lastError: null
    });
    launchRun(this, {
      context,
      memories,
      settings: runSettings
    });

    return {
      ok: true,
      runId,
      taskId,
      conversationId: this.activeRun.conversationId,
      messageId: regeneration.targetMessage.id
    };
  }
};
