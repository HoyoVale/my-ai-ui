import { buildShortTermContext } from "../contextBuilder.js";
import { interruptPlanState } from "../../agent/planState.js";
import * as internals from "../ConversationManagerInternals.js";

export const ConversationMessageService = {
  appendMessage({
    conversationId,
    role,
    content,
    status = "complete",
    durationMs = 0,
    toolCalls = [],
    plan = [],
    planState = null,
    stopReason = "",
    resumedFromMessageId = "",
    taskId = "",
    executionThreadId = "",
    activity = null,
    skillRun = null,
    tokenLedger = null,
    diffSummary = null
  }) {
    const data =
      this.ensureLoaded();
  
    const conversation =
      data.conversations.find(
        (item) =>
          item.id ===
          conversationId
      );
  
    if (!conversation) {
      throw new Error(
        "Conversation not found."
      );
    }
  
    const normalizedContent =
      String(content ?? "")
        .trim();
  
    const canStoreEmptyAssistant =
      role === "assistant" &&
      Boolean(activity);
  
    if (
      !normalizedContent &&
      !canStoreEmptyAssistant
    ) {
      throw new Error(
        "Message content is empty."
      );
    }
  
    const timestamp =
      this.now();
  
    const message = {
      id: this.createId(),
      role,
      content:
        normalizedContent,
      status,
      includeInContext: true,
      pinnedToContext: false,
      createdAt: timestamp
    };
  
    this.applyAssistantMetadata(
      message,
      {
        durationMs,
        toolCalls,
        plan,
        planState,
        stopReason,
        resumedFromMessageId,
        taskId,
        executionThreadId,
        activity,
        skillRun,
        tokenLedger,
        diffSummary
      }
    );
  
    conversation.messages.push(
      message
    );
  
    conversation.updatedAt =
      timestamp;
  
    const settings =
      this.getConversationSettings();
  
    if (
      role === "user" &&
      settings.autoTitle &&
      conversation.title ===
        "新会话"
    ) {
      conversation.title =
        internals.createTitle(
          normalizedContent
        );
    }
  
    data.conversations.sort(
      (left, right) =>
        right.updatedAt -
        left.updatedAt
    );
  
    this.prune();
    this.commit();
  
    return internals.clone(
      message
    );
  },

  prepareRegeneration({
    conversationId,
    messageId
  }) {
    const conversation =
      this.getConversation(
        conversationId
      );
  
    if (!conversation) {
      return {
        ok: false,
        code: "conversation-not-found",
        message: "会话不存在。"
      };
    }
  
    const targetIndex =
      conversation.messages.findIndex(
        (message) =>
          message.id === messageId
      );
  
    const target =
      conversation.messages[
        targetIndex
      ];
  
    if (
      !target ||
      target.role !== "assistant"
    ) {
      return {
        ok: false,
        code: "assistant-message-not-found",
        message: "找不到可重新生成的回复。"
      };
    }
  
    if (
      targetIndex !==
      conversation.messages.length - 1
    ) {
      return {
        ok: false,
        code: "not-latest-assistant-message",
        message: "当前仅支持重新生成最后一条助手回复。"
      };
    }
  
    const userMessage =
      conversation.messages[
        targetIndex - 1
      ];
  
    if (
      !userMessage ||
      userMessage.role !== "user"
    ) {
      return {
        ok: false,
        code: "user-message-not-found",
        message: "找不到对应的用户消息。"
      };
    }
  
    const contextConversation =
      internals.clone(conversation);
  
    contextConversation.messages.splice(
      targetIndex,
      1
    );
  
    return {
      ok: true,
      conversation:
        contextConversation,
      userMessage:
        internals.clone(userMessage),
      targetMessage:
        internals.clone(target)
    };
  },

  replaceAssistantMessage({
    conversationId,
    messageId,
    content,
    status = "complete",
    durationMs = 0,
    toolCalls = [],
    plan = [],
    planState = null,
    stopReason = "",
    resumedFromMessageId = "",
    taskId = "",
    executionThreadId = "",
    activity = null,
    skillRun = null,
    tokenLedger = null,
    diffSummary = null,
    preserveCreatedAt = false
  }) {
    const conversation =
      this.findMutableConversation(
        conversationId
      );
  
    if (!conversation) {
      return {
        ok: false,
        code: "conversation-not-found",
        message: "会话不存在。"
      };
    }
  
    const message =
      conversation.messages.find(
        (item) =>
          item.id === messageId
      );
  
    if (
      !message ||
      message.role !== "assistant"
    ) {
      return {
        ok: false,
        code: "assistant-message-not-found",
        message: "助手回复不存在。"
      };
    }
  
    const normalizedContent =
      String(content ?? "")
        .trim();
  
    const canStoreEmptyAssistant =
      Boolean(activity);
  
    if (
      !normalizedContent &&
      !canStoreEmptyAssistant
    ) {
      return {
        ok: false,
        code: "empty-message",
        message: "回复内容为空。"
      };
    }
  
    message.content =
      normalizedContent;
    message.status = status;
  
    if (!preserveCreatedAt) {
      message.createdAt =
        this.now();
    }
  
    delete message.durationMs;
    delete message.toolCalls;
    delete message.plan;
    delete message.planState;
    delete message.stopReason;
    delete message.resumedFromMessageId;
    delete message.taskId;
    delete message.activity;
    delete message.skillRun;
    delete message.tokenLedger;
    delete message.diffSummary;
  
    this.applyAssistantMetadata(
      message,
      {
        durationMs,
        toolCalls,
        plan,
        planState,
        stopReason,
        resumedFromMessageId,
        taskId,
        executionThreadId,
        activity,
        skillRun,
        tokenLedger,
        diffSummary
      }
    );
  
    conversation.updatedAt =
      preserveCreatedAt
        ? this.now()
        : message.createdAt;
  
    this.ensureLoaded()
      .conversations
      .sort(
        (left, right) =>
          right.updatedAt -
          left.updatedAt
      );
  
    this.commit();
  
    return {
      ok: true,
      message: internals.clone(message)
    };
  },

  applyAssistantMetadata(
    message,
    {
      durationMs = 0,
      toolCalls = [],
      plan = [],
      planState = null,
      stopReason = "",
      resumedFromMessageId = "",
      taskId = "",
      executionThreadId = "",
      activity = null,
      skillRun = null,
      tokenLedger = null,
      diffSummary = null
    } = {}
  ) {
    if (
      message.role !== "assistant"
    ) {
      return;
    }
  
    const normalizedDuration =
      Math.max(
        0,
        Math.round(
          Number(durationMs) || 0
        )
      );
  
  
  
    if (normalizedDuration > 0) {
      message.durationMs =
        normalizedDuration;
    }
  
    if (
      Array.isArray(toolCalls) &&
      toolCalls.length > 0
    ) {
      message.toolCalls =
        internals.clone(toolCalls);
    }
  
    if (
      Array.isArray(plan) &&
      plan.length > 0
    ) {
      message.plan = internals.clone(plan);
    }
  
    if (planState && typeof planState === "object") {
      message.planState = internals.clone(planState);
    }
  
    if (stopReason) {
      message.stopReason =
        String(stopReason);
    }
  
  
  
    if (resumedFromMessageId) {
      message.resumedFromMessageId =
        String(resumedFromMessageId);
    }
  
    if (taskId) {
      message.taskId =
        String(taskId);
    }
  
    if (executionThreadId) {
      message.executionThreadId = String(executionThreadId);
    }
  
    if (
      activity &&
      typeof activity === "object"
    ) {
      message.activity =
        internals.clone(activity);
    }
  
    if (
      skillRun &&
      typeof skillRun === "object"
    ) {
      message.skillRun = internals.clone(skillRun);
    }
  
    if (tokenLedger && typeof tokenLedger === "object") {
      message.tokenLedger = internals.clone(tokenLedger);
    }
  
    if (diffSummary && typeof diffSummary === "object" && diffSummary.empty !== true) {
      message.diffSummary = internals.clone(diffSummary);
    }
  },

  recoverInterruptedRuns({ runtimeRecoveries = [] } = {}) {
    const data = this.ensureLoaded();
    const timestamp = this.now();
    const recoveryMap = new Map(
      Array.isArray(runtimeRecoveries)
        ? runtimeRecoveries
            .filter((item) => item?.taskId)
            .map((item) => [String(item.taskId), item])
        : Object.entries(runtimeRecoveries ?? {})
    );
    let recovered = 0;
  
    for (const conversation of data.conversations) {
      for (const message of conversation.messages) {
        if (message.role !== "assistant") {
          continue;
        }
  
        const activity = message.activity;
        const runtimeDecision = recoveryMap.get(String(message.taskId ?? ""));
        const unfinished =
          ["running", "cancelling"].includes(message.status) ||
          ["running", "cancelling", "resumed"].includes(activity?.status) ||
          runtimeDecision?.applyToConversation === true;
  
        if (!unfinished) {
          continue;
        }
  
        const activityStatus = String(
          runtimeDecision?.activityStatus ?? "interrupted"
        );
        const messageStatus = String(
          runtimeDecision?.messageStatus ?? "interrupted"
        );
        const stopReason = String(
          runtimeDecision?.stopReason ?? "interrupted"
        );
        const statusTitle = String(
          runtimeDecision?.title ?? "执行被中断"
        );
        const recoveryCalls = runtimeDecision?.recovery?.calls ?? [];
  
        message.status = messageStatus;
        message.stopReason = stopReason;
  
        const interruptionReason =
          runtimeDecision?.recovery?.unresolvedCount > 0
            ? "请先处理尚未确认的工具操作"
            : "应用退出导致执行中断";
        const interruptedPlanState = interruptPlanState(
          message.planState ?? message.plan ?? [],
          interruptionReason
        );
        message.planState = interruptedPlanState;
        message.plan = interruptedPlanState.rootItems;
  
        if (activity && typeof activity === "object") {
          activity.status = activityStatus;
          activity.outcome = runtimeDecision?.outcome ?? "interrupted";
          activity.resumable = runtimeDecision?.resumable !== false;
          activity.stopReason = stopReason;
          activity.endedAt = timestamp;
          activity.durationMs = Math.max(
            0,
            timestamp - Number(activity.startedAt || timestamp)
          );
  
          activity.checkpoint = {
            ...(activity.checkpoint ?? {}),
            ...(runtimeDecision?.checkpoint ?? {}),
            phase: runtimeDecision?.phase ?? "interrupted",
            outcome: runtimeDecision?.outcome ?? "interrupted",
            resumable: runtimeDecision?.resumable !== false,
            publicStatus: messageStatus,
            stopReason,
            toolRuntime:
              runtimeDecision?.recovery ??
              activity.checkpoint?.toolRuntime ??
              null,
            updatedAt: timestamp,
            plan: internals.clone(message.plan ?? activity.checkpoint?.plan ?? []),
            planState: internals.clone(
              message.planState ??
              activity.checkpoint?.planState ??
              message.plan ?? []
            )
          };
  
          const events = Array.isArray(activity.events)
            ? activity.events
            : [];
          let statusEventFound = false;
  
          activity.events = events.map((event) => {
            if (event.type === "tool" && ["queued", "running", "retrying"].includes(event.status)) {
              const callId = String(
                event.tool?.runtime?.callId ??
                event.tool?.callId ??
                event.tool?.id ??
                ""
              );
              const toolName = String(event.tool?.name ?? "");
              const unresolved = recoveryCalls.find((call) =>
                (callId && call.callId === callId) ||
                (!callId && toolName && call.toolName === toolName)
              );
  
              if (unresolved) {
                return {
                  ...event,
                  status: "attention",
                  updatedAt: timestamp,
                  tool: {
                    ...event.tool,
                    status: "attention",
                    endedAt: timestamp,
                    runtime: {
                      ...(event.tool?.runtime ?? {}),
                      callId: unresolved.callId,
                      recovery: unresolved.recovery,
                      actions: internals.clone(unresolved.actions ?? [])
                    },
                    result: event.tool?.result ?? {
                      ok: false,
                      error: {
                        type: "RECOVERY_REQUIRED",
                        code: "TOOL_RECOVERY_REQUIRED",
                        message: statusTitle,
                        retryable: false
                      }
                    }
                  }
                };
              }
  
              return {
                ...event,
                status: "cancelled",
                updatedAt: timestamp,
                tool: {
                  ...event.tool,
                  status: "cancelled",
                  endedAt: timestamp,
                  result: event.tool?.result ?? {
                    ok: false,
                    error: {
                      type: "CANCELLED",
                      code: "APP_INTERRUPTED",
                      message: "应用退出导致工具执行中断。",
                      retryable: false
                    }
                  }
                }
              };
            }
  
            if (event.type === "plan" && Array.isArray(event.plan)) {
              return {
                ...event,
                status: runtimeDecision?.recovery?.unresolvedCount > 0
                  ? "attention"
                  : "failed",
                updatedAt: timestamp,
                plan: internals.clone(message.plan ?? event.plan)
              };
            }
  
            if (event.type === "status") {
              statusEventFound = true;
              return {
                ...event,
                status: activityStatus,
                title: statusTitle,
                stopReason,
                updatedAt: timestamp
              };
            }
  
            return event;
          });
  
          if (!statusEventFound) {
            activity.events.push({
              id: `run:${activity.runId || message.id}`,
              type: "status",
              sequence: activity.events.length,
              status: activityStatus,
              title: statusTitle,
              stopReason,
              createdAt: timestamp,
              updatedAt: timestamp
            });
          }
        }
  
        conversation.updatedAt = timestamp;
        recovered += 1;
      }
    }
  
    if (recovered > 0) {
      this.commit();
    }
  
    return {
      ok: true,
      recovered
    };
  },

  buildContext(
    conversationId
  ) {
    const conversation =
      this.getConversation(
        conversationId
      );
  
    if (!conversation) {
      return [];
    }
  
    return buildShortTermContext({
      messages:
        conversation.messages,
  
      maxTurns:
        this
          .getConversationSettings()
          .contextTurns,
  
      contextStartAfterMessageId:
        conversation
          .contextStartAfterMessageId
    });
  },

  resetContext(
    conversationId
  ) {
    const conversation =
      this.findMutableConversation(
        conversationId
      );
  
    if (!conversation) {
      return {
        ok: false,
        code: "conversation-not-found",
        message: "会话不存在。"
      };
    }
  
    conversation
      .contextStartAfterMessageId =
      conversation.messages.at(-1)
        ?.id ?? null;
  
    conversation.updatedAt =
      this.now();
  
    this.commit();
  
    return {
      ok: true,
      contextStartAfterMessageId:
        conversation
          .contextStartAfterMessageId
    };
  },

  updateMessageContext({
    conversationId,
    messageId,
    includeInContext,
    pinnedToContext
  }) {
    const conversation =
      this.findMutableConversation(
        conversationId
      );
  
    if (!conversation) {
      return {
        ok: false,
        code: "conversation-not-found",
        message: "会话不存在。"
      };
    }
  
    const message =
      conversation.messages.find(
        (item) =>
          item.id === messageId
      );
  
    if (!message) {
      return {
        ok: false,
        code: "message-not-found",
        message: "消息不存在。"
      };
    }
  
    if (
      typeof includeInContext ===
      "boolean"
    ) {
      message.includeInContext =
        includeInContext;
  
      if (!includeInContext) {
        message.pinnedToContext =
          false;
      }
    }
  
    if (
      typeof pinnedToContext ===
      "boolean" &&
      message.includeInContext !== false
    ) {
      message.pinnedToContext =
        pinnedToContext;
    }
  
    conversation.updatedAt =
      this.now();
  
    this.commit();
  
    return {
      ok: true,
      message: internals.clone(message)
    };
  }
};
