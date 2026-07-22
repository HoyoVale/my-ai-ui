import crypto from "node:crypto";

import {
  conversationManager
} from "../../conversation/index.js";

import {
  platformKernel
} from "../../platform/index.js";

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
  createCheckpointContinuationState,
  isExplicitNewTask,
  resolveCheckpointContinuation
} from "../checkpointResume.js";

import {
  resolveExecutionThreadContinuation
} from "../ExecutionThread.js";

import {
  LIVE_STEP_ROLES
} from "../stepText.js";

import {
  appendTaskContinuationToContext,
  classifyWorkingInstruction,
  createRunStateFields,
  getActiveCredentialError
} from "../AgentRuntimeInternals.js";

import {
  ROUTING_ACTIONS,
  THREAD_COMMANDS,
  executionThreadRouter,
  threadRoutingDecisionStore
} from "../../execution-model/index.js";

export const agentRunPreparation = {
  startMessage(
    content,
    {
      expectedConversationId = "",
      continueTask = false,
      threadCommand = ""
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

    const initialConversation =
      conversationManager.getCurrentConversation();

    if (this.activeRun) {
      const routingDecision = executionThreadRouter.route({
        conversation: initialConversation,
        activeRun: this.activeRun,
        message,
        requestedCommand: threadCommand,
        explicitContinue: continueTask === true,
        legacyAction: ROUTING_ACTIONS.REJECT,
        shadowMode: true
      });
      this.lastThreadRoutingDecision =
        threadRoutingDecisionStore.record(routingDecision);
      return {
        ok: false,
        code: "busy",
        message:
          "当前回复尚未结束，请先停止生成。"
      };
    }

    const credentialConversation =
      initialConversation;
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
    let userMessage = null;
    let routingDecision = null;

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
        }) ??
        resolveExecutionThreadContinuation({
          conversation,
          message,
          explicit: continueTask === true
        });
      continuationState =
        createCheckpointContinuationState(
          checkpointContinuation
        );

      routingDecision = executionThreadRouter.route({
        conversation,
        message,
        requestedCommand: threadCommand,
        explicitContinue: continueTask === true,
        legacyAction: continuationState
          ? ROUTING_ACTIONS.RESUME
          : ROUTING_ACTIONS.START,
        shadowMode: true
      });
      this.lastThreadRoutingDecision =
        threadRoutingDecisionStore.record(routingDecision);

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

      userMessage = conversationManager
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
      executionConversation.goal?.status === "active" &&
      !isExplicitNewTask(message)
        ? executionConversation.goal
        : null;

    const goalId =
      continuationState?.goalId ||
      persistentGoal?.id ||
      "";

    const taskId =
      continuationState?.taskId ||
      crypto.randomUUID();

    const existingExecutionThread = executionConversation.executionThread;
    const executionThreadId =
      continuationState?.executionThreadId ||
      (existingExecutionThread?.taskId === taskId
        ? existingExecutionThread.id
        : "") ||
      crypto.randomUUID();

    if (routingDecision) {
      routingDecision = threadRoutingDecisionStore.update(
        routingDecision.id,
        {
          messageId: userMessage?.id ?? "",
          targetThreadId: executionThreadId,
          targetRunId: runId
        }
      ) ?? routingDecision;
      this.lastThreadRoutingDecision = routingDecision;
    }

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
      executionThreadId,
      threadRoutingDecision: routingDecision,
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
        persistentGoal ? runMessage : continuationState ? runMessage : "",
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
        continuationState?.initialPlan ??
        persistentGoal?.planAuthority?.state?.rootItems ??
        [],
      initialPlanState:
        continuationState?.initialPlanState ??
        persistentGoal?.planAuthority?.state ??
        continuationState?.initialPlan ??
        [],
      workingState:
        continuationState?.workingState ??
        persistentGoal?.workingState ??
        null,
      resumedFromMessageId:
        continuationState?.resumedFromMessageId ?? "",
      platformRunId: "",
      platformLeaseIds: [],
      platformError: null,
      resumeInPlace: false,
      finalizationAttemptCount: 0,
      contextCompactionCount:
        continuationState?.contextCompactionCount ?? 0,
      diffTracker: new RunDiffTracker({
        runId,
        workspaceId: executionConversation.workspaceId ?? ""
      }),
      tokenLedger: new TokenLedger({
        runId,
        goalId,
        taskId,
        providerId: context.metadata?.activeModel?.providerId ?? "",
        modelId: context.metadata?.activeModel?.modelId ?? "",
        context
      }),
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
      const workingState = conversationManager.recordGoalWorkingState({
        conversationId: conversation.id,
        goalId: persistentGoal.id,
        patch: {
          lastUserInstruction: runMessage,
          lastRunId: runId,
          ...classifyWorkingInstruction(runMessage),
          reason: continuationState
            ? "goal-continuation-instruction"
            : "goal-run-instruction"
        }
      });
      if (workingState?.ok) {
        this.activeRun.workingState = workingState.goal.workingState;
        this.activeRun.goalSpec = workingState.goal;
      }
    }

    const executionThread = conversationManager.beginExecutionThread({
      conversationId: conversation.id,
      threadId: executionThreadId,
      taskId,
      goalId,
      platformRunId: this.activeRun.platformRunId,
      objective: this.activeRun.objective,
      mode: this.activeRun.mode,
      workspaceId: this.activeRun.workspaceId ?? "",
      planState: this.activeRun.initialPlanState,
      workingState: this.activeRun.workingState,
      runId
    });
    if (executionThread?.ok) {
      this.activeRun.executionThread = executionThread.thread;
      this.activeRun.continuationCount = executionThread.thread.continuationCount;
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
  },

  regenerateMessage({
    conversationId,
    messageId
  } = {}) {
    if (this.activeRun) {
      const routingDecision = executionThreadRouter.route({
        operation: THREAD_COMMANDS.REGENERATE,
        conversation: conversationManager.getConversation(
          String(conversationId ?? "")
        ),
        activeRun: this.activeRun,
        messageId: String(messageId ?? ""),
        legacyAction: ROUTING_ACTIONS.REJECT,
        shadowMode: true
      });
      this.lastThreadRoutingDecision =
        threadRoutingDecisionStore.record(routingDecision);
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

    const regenerationSourceRunId = String(
      plan.targetMessage?.activity?.runId ??
      plan.targetMessage?.runId ??
      ""
    );
    const regenerationThreadId = String(
      plan.targetMessage?.executionThreadId ??
      plan.conversation.executionThread?.id ??
      ""
    );
    let routingDecision = executionThreadRouter.route({
      operation: THREAD_COMMANDS.REGENERATE,
      conversation: plan.conversation,
      messageId: plan.userMessage?.id ?? "",
      sourceRunId: regenerationSourceRunId,
      targetThreadId: regenerationThreadId,
      targetRunId: runId,
      legacyAction: ROUTING_ACTIONS.REGENERATE,
      shadowMode: true
    });
    routingDecision = threadRoutingDecisionStore.record(routingDecision);
    this.lastThreadRoutingDecision = routingDecision;

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
      threadRoutingDecision: routingDecision,
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
      diffTracker: new RunDiffTracker({
        runId,
        workspaceId: plan.conversation.workspaceId ?? ""
      }),
      tokenLedger: new TokenLedger({
        runId,
        goalId,
        taskId,
        providerId: context.metadata?.activeModel?.providerId ?? "",
        modelId: context.metadata?.activeModel?.modelId ?? "",
        context
      }),
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
};
