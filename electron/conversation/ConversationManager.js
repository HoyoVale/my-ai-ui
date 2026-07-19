import crypto from "node:crypto";

import {
  buildShortTermContext
} from "./contextBuilder.js";

import {
  normalizeSessionMode,
  resolveModelBinding
} from "./sessionContext.js";


function clone(value) {
  return structuredClone(value);
}

function createTitle(
  content
) {
  const normalized =
    String(content ?? "")
      .replace(/\s+/g, " ")
      .trim();

  if (!normalized) {
    return "新会话";
  }

  return normalized.length > 28
    ? `${normalized.slice(0, 28)}…`
    : normalized;
}

export class ConversationManager {
  constructor({
    store,
    getSettings,
    now = () => Date.now(),
    createId = () =>
      crypto.randomUUID(),
    getWorkspaceById = () => null,
    createWorkspaceSnapshot = (workspace) =>
      workspace
        ? {
            id: String(workspace.id ?? ""),
            name: String(workspace.name ?? "工作区"),
            rootPath: String(workspace.rootPath ?? ""),
            canonicalPath: String(
              workspace.canonicalPath ?? workspace.rootPath ?? ""
            )
          }
        : null,
    onChange = () => {}
  }) {
    if (!store) {
      throw new TypeError(
        "ConversationManager requires a store."
      );
    }

    this.store = store;

    this.getSettings =
      typeof getSettings ===
        "function"
        ? getSettings
        : () => ({
            conversation: {
              contextTurns: 8,
              maxConversations: 100,
              autoTitle: true,
              saveAbortedReplies: true
            }
          });

    this.now = now;
    this.createId =
      createId;
    this.getWorkspaceById =
      typeof getWorkspaceById === "function"
        ? getWorkspaceById
        : () => null;
    this.createWorkspaceSnapshot =
      typeof createWorkspaceSnapshot === "function"
        ? createWorkspaceSnapshot
        : () => null;
    this.onChange =
      onChange;

    this.data = null;
  }

  ensureLoaded() {
    if (!this.data) {
      this.data =
        this.store.load();
    }

    return this.data;
  }

  resolveWorkspaceBinding(workspaceId) {
    const normalizedId =
      workspaceId === null
        ? null
        : String(workspaceId ?? "").trim() || null;

    if (!normalizedId) {
      return {
        workspaceId: null,
        workspaceSnapshot: null
      };
    }

    const workspace = this.getWorkspaceById(
      normalizedId
    );

    if (!workspace || workspace.missing) {
      const error = new Error(
        workspace?.missing
          ? "工作区目录不存在，请在工作上下文中重新添加。"
          : "工作区不存在或已被移除。"
      );
      error.code = "workspace-not-found";
      throw error;
    }

    return {
      workspaceId: workspace.id,
      workspaceSnapshot:
        this.createWorkspaceSnapshot(workspace)
    };
  }

  currentWorkspaceId() {
    const data = this.ensureLoaded();
    const current = data.conversations.find(
      (conversation) =>
        conversation.id === data.currentConversationId
    );

    return current?.workspaceId ?? null;
  }

  currentMode() {
    const data = this.ensureLoaded();
    const current = data.conversations.find(
      (conversation) =>
        conversation.id === data.currentConversationId
    );

    return current?.mode ?? "chat";
  }

  getState() {
    const data =
      this.ensureLoaded();

    const current =
      data.conversations.find(
        (conversation) =>
          conversation.id ===
          data.currentConversationId
      ) ?? null;

    return {
      currentConversationId:
        data.currentConversationId,

      currentConversation:
        current
          ? this.toSummary(
              current
            )
          : null,

      currentWorkspaceId:
        current?.workspaceId ?? null,
      currentWorkspace:
        current?.workspaceSnapshot ?? null,
      currentMode:
        current?.mode ?? "chat",
      currentModelSelection:
        current?.modelSelection ?? null,
      currentModel:
        current?.modelSnapshot ?? null,

      totalConversations:
        data.conversations.length
    };
  }

  list({ workspaceId, mode } = {}) {
    const hasWorkspaceFilter = workspaceId !== undefined;
    const normalizedWorkspaceId =
      workspaceId === null
        ? null
        : String(workspaceId ?? "").trim() || null;
    const normalizedMode = mode === undefined
      ? null
      : normalizeSessionMode(mode, "chat");

    return this
      .ensureLoaded()
      .conversations
      .filter((conversation) =>
        (!hasWorkspaceFilter ||
          (conversation.workspaceId ?? null) === normalizedWorkspaceId) &&
        (!normalizedMode || conversation.mode === normalizedMode)
      )
      .map((conversation) =>
        this.toSummary(
          conversation
        )
      );
  }

  getConversation(id) {
    const conversation =
      this.ensureLoaded()
        .conversations
        .find(
          (item) =>
            item.id === id
        );

    return conversation
      ? clone(conversation)
      : null;
  }

  getCurrentConversation() {
    const data =
      this.ensureLoaded();

    if (
      data.currentConversationId
    ) {
      const current =
        this.getConversation(
          data.currentConversationId
        );

      if (current) {
        return current;
      }
    }

    return this.create();
  }

  create({
    title = "新会话",
    mode = undefined,
    workspaceId = undefined,
    modelSelection = undefined
  } = {}) {
    const data =
      this.ensureLoaded();
    const current = data.conversations.find(
      (conversation) =>
        conversation.id === data.currentConversationId
    ) ?? null;
    const resolvedMode = normalizeSessionMode(
      mode,
      current?.mode ?? "chat"
    );
    const inheritedWorkspaceId =
      workspaceId === undefined
        ? current?.mode === resolvedMode
          ? current.workspaceId
          : null
        : workspaceId;
    const binding =
      this.resolveWorkspaceBinding(
        inheritedWorkspaceId
      );

    if (resolvedMode === "coding" && !binding.workspaceId) {
      const error = new Error(
        "Coding 会话必须先绑定工作区。"
      );
      error.code = "coding-workspace-required";
      throw error;
    }

    const modelBinding = resolveModelBinding(
      this.getSettings().model,
      modelSelection === undefined
        ? current?.modelSelection ?? null
        : modelSelection
    );

    const timestamp =
      this.now();

    const conversation = {
      id: this.createId(),
      mode: resolvedMode,
      workspaceId:
        binding.workspaceId,
      workspaceSnapshot:
        binding.workspaceSnapshot,
      modelSelection:
        modelBinding.selection,
      modelSnapshot:
        modelBinding.snapshot,
      title:
        String(title)
          .trim()
          .slice(0, 80) ||
        "新会话",

      contextStartAfterMessageId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: []
    };

    data.conversations.unshift(
      conversation
    );

    data.currentConversationId =
      conversation.id;

    this.prune();
    this.commit();

    return clone(
      conversation
    );
  }

  findRecentConversation({
    mode,
    workspaceId = undefined
  }) {
    const resolvedMode = normalizeSessionMode(mode, "chat");
    const hasWorkspace = workspaceId !== undefined;
    const normalizedWorkspaceId = workspaceId === null
      ? null
      : String(workspaceId ?? "").trim() || null;

    return this.ensureLoaded().conversations
      .filter((conversation) => {
        if (conversation.mode !== resolvedMode) {
          return false;
        }

        if (
          hasWorkspace &&
          (conversation.workspaceId ?? null) !== normalizedWorkspaceId
        ) {
          return false;
        }

        if (resolvedMode === "coding" && !hasWorkspace) {
          const workspace = this.getWorkspaceById(
            conversation.workspaceId
          );
          return Boolean(workspace && !workspace.missing);
        }

        return true;
      })
      .sort(
        (left, right) =>
          Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
      )[0] ?? null;
  }

  navigateContext({
    mode,
    workspaceId = undefined
  } = {}) {
    const resolvedMode = normalizeSessionMode(mode, this.currentMode());

    if (resolvedMode === "coding" && workspaceId === null) {
      return {
        ok: false,
        code: "coding-workspace-required",
        message: "Coding 会话必须先选择工作区。"
      };
    }

    if (workspaceId !== undefined && workspaceId !== null) {
      try {
        this.resolveWorkspaceBinding(workspaceId);
      } catch (error) {
        return {
          ok: false,
          code: error?.code ?? "workspace-not-found",
          message: error instanceof Error
            ? error.message
            : "工作区不可用。"
        };
      }
    }

    const existing = this.findRecentConversation({
      mode: resolvedMode,
      workspaceId
    });

    if (existing) {
      const selected = this.select(existing.id);
      return {
        ...selected,
        created: false,
        conversation: clone(existing)
      };
    }

    if (resolvedMode === "coding" && workspaceId === undefined) {
      return {
        ok: false,
        code: "coding-workspace-required",
        message: "尚无 Coding 会话，请先选择工作区。"
      };
    }

    try {
      const conversation = this.create({
        mode: resolvedMode,
        workspaceId: resolvedMode === "chat"
          ? workspaceId ?? null
          : workspaceId
      });

      return {
        ok: true,
        created: true,
        conversation
      };
    } catch (error) {
      return {
        ok: false,
        code: error?.code ?? "conversation-context-failed",
        message: error instanceof Error
          ? error.message
          : "无法切换会话上下文。"
      };
    }
  }

  setModelSelection({
    conversationId,
    providerId,
    modelConfigId
  } = {}) {
    const conversation = this.findMutableConversation(
      conversationId || this.ensureLoaded().currentConversationId
    );

    if (!conversation) {
      return {
        ok: false,
        code: "conversation-not-found",
        message: "会话不存在。"
      };
    }

    const binding = resolveModelBinding(
      this.getSettings().model,
      { providerId, modelConfigId }
    );

    if (!binding.selection) {
      return {
        ok: false,
        code: "model-not-found",
        message: "模型不存在或已被移除。"
      };
    }

    conversation.modelSelection = binding.selection;
    conversation.modelSnapshot = binding.snapshot;
    conversation.updatedAt = this.now();
    this.commit();

    return {
      ok: true,
      conversation: clone(conversation)
    };
  }

  switchWorkspace(workspaceId = null) {
    return this.navigateContext({
      mode: "chat",
      workspaceId
    });
  }

  switchMode(mode) {
    return this.navigateContext({
      mode,
      workspaceId: undefined
    });
  }

  rename({
    conversationId,
    title
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

    const normalizedTitle =
      String(title ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);

    if (!normalizedTitle) {
      return {
        ok: false,
        code: "empty-title",
        message: "会话名称不能为空。"
      };
    }

    conversation.title =
      normalizedTitle;

    this.commit();

    return {
      ok: true,
      conversation:
        this.getConversation(
          conversationId
        )
    };
  }

  select(id) {
    const data =
      this.ensureLoaded();

    const exists =
      data.conversations.some(
        (conversation) =>
          conversation.id ===
          id
      );

    if (!exists) {
      return {
        ok: false,
        code:
          "conversation-not-found"
      };
    }

    data.currentConversationId =
      id;

    this.commit();

    return {
      ok: true,
      conversation:
        this.getConversation(id)
    };
  }

  delete(id) {
    const data =
      this.ensureLoaded();

    const previousLength =
      data.conversations.length;

    data.conversations =
      data.conversations.filter(
        (conversation) =>
          conversation.id !== id
      );

    if (
      data.conversations.length ===
      previousLength
    ) {
      return {
        ok: false,
        code:
          "conversation-not-found"
      };
    }

    if (
      data.currentConversationId ===
      id
    ) {
      data.currentConversationId =
        data.conversations[0]?.id ??
        null;
    }

    this.commit();

    return {
      ok: true
    };
  }

  clearAll() {
    const data =
      this.ensureLoaded();

    data.currentConversationId =
      null;

    data.conversations = [];

    this.commit();

    return {
      ok: true
    };
  }

  appendMessage({
    conversationId,
    role,
    content,
    status = "complete",
    durationMs = 0,
    toolCalls = [],
    plan = [],
    stopReason = "",
    resumedFromMessageId = "",
    taskId = "",
    activity = null
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
        stopReason,
        resumedFromMessageId,
        taskId,
        activity
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
        createTitle(
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

    return clone(
      message
    );
  }

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
      clone(conversation);

    contextConversation.messages.splice(
      targetIndex,
      1
    );

    return {
      ok: true,
      conversation:
        contextConversation,
      userMessage:
        clone(userMessage),
      targetMessage:
        clone(target)
    };
  }

  replaceAssistantMessage({
    conversationId,
    messageId,
    content,
    status = "complete",
    durationMs = 0,
    toolCalls = [],
    plan = [],
    stopReason = "",
    resumedFromMessageId = "",
    taskId = "",
    activity = null,
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
    delete message.stopReason;
    delete message.resumedFromMessageId;
    delete message.taskId;
    delete message.activity;

    this.applyAssistantMetadata(
      message,
      {
        durationMs,
        toolCalls,
        plan,
        stopReason,
        resumedFromMessageId,
        taskId,
        activity
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
      message: clone(message)
    };
  }

  applyAssistantMetadata(
    message,
    {
      durationMs = 0,
      toolCalls = [],
      plan = [],
      stopReason = "",
      resumedFromMessageId = "",
      taskId = "",
      activity = null
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
        clone(toolCalls);
    }

    if (
      Array.isArray(plan) &&
      plan.length > 0
    ) {
      message.plan = clone(plan);
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

    if (
      activity &&
      typeof activity === "object"
    ) {
      message.activity =
        clone(activity);
    }
  }

  recoverInterruptedRuns() {
    const data = this.ensureLoaded();
    const timestamp = this.now();
    let recovered = 0;

    for (const conversation of data.conversations) {
      for (const message of conversation.messages) {
        if (message.role !== "assistant") {
          continue;
        }

        const activity = message.activity;
        const unfinished =
          ["running", "cancelling"].includes(message.status) ||
          ["running", "cancelling", "resumed"].includes(activity?.status);

        if (!unfinished) {
          continue;
        }

        message.status = "interrupted";
        message.stopReason = "interrupted";

        if (Array.isArray(message.plan)) {
          message.plan = message.plan.map((item) =>
            item.status === "in_progress"
              ? {
                  ...item,
                  status: "blocked",
                  reason: item.reason || "应用退出导致执行中断"
                }
              : item
          );
        }

        if (activity && typeof activity === "object") {
          activity.status = "interrupted";
          activity.stopReason = "interrupted";
          activity.endedAt = timestamp;
          activity.durationMs = Math.max(
            0,
            timestamp - Number(activity.startedAt || timestamp)
          );

          if (activity.checkpoint) {
            activity.checkpoint = {
              ...activity.checkpoint,
              phase: "interrupted",
              stopReason: "interrupted",
              updatedAt: timestamp,
              plan: clone(message.plan ?? activity.checkpoint.plan ?? [])
            };
          }

          const events = Array.isArray(activity.events)
            ? activity.events
            : [];
          let statusEventFound = false;

          activity.events = events.map((event) => {
            if (event.type === "tool" && ["queued", "running", "retrying"].includes(event.status)) {
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
                status: "failed",
                updatedAt: timestamp,
                plan: clone(message.plan ?? event.plan)
              };
            }

            if (event.type === "status") {
              statusEventFound = true;
              return {
                ...event,
                status: "interrupted",
                title: "执行被中断",
                stopReason: "interrupted",
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
              status: "interrupted",
              title: "执行被中断",
              stopReason: "interrupted",
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
  }

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
  }

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
  }

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
      message: clone(message)
    };
  }

  findMutableConversation(id) {
    return this
      .ensureLoaded()
      .conversations
      .find(
        (conversation) =>
          conversation.id === id
      ) ?? null;
  }

  getConversationSettings() {
    const settings =
      this.getSettings();

    return {
      contextTurns:
        settings
          ?.conversation
          ?.contextTurns ??
        8,

      maxConversations:
        settings
          ?.conversation
          ?.maxConversations ??
        100,

      autoTitle:
        settings
          ?.conversation
          ?.autoTitle ??
        true,

      saveAbortedReplies:
        settings
          ?.conversation
          ?.saveAbortedReplies ??
        true
    };
  }

  prune() {
    const data =
      this.ensureLoaded();

    const maxConversations =
      Math.max(
        1,
        this
          .getConversationSettings()
          .maxConversations
      );

    if (
      data.conversations.length <=
      maxConversations
    ) {
      return;
    }

    const current =
      data.currentConversationId;

    const kept =
      data.conversations.slice(
        0,
        maxConversations
      );

    if (
      current &&
      !kept.some(
        (conversation) =>
          conversation.id ===
          current
      )
    ) {
      const currentConversation =
        data.conversations.find(
          (conversation) =>
            conversation.id ===
            current
        );

      if (currentConversation) {
        kept[
          kept.length - 1
        ] =
          currentConversation;
      }
    }

    data.conversations =
      kept;
  }

  reconcileSettings() {
    this.ensureLoaded();
    this.prune();
    this.commit();

    return this.getState();
  }

  commit() {
    this.data =
      this.store.save(
        this.data
      );

    this.onChange(
      this.getState()
    );
  }

  toSummary(
    conversation
  ) {
    const lastMessage =
      conversation
        .messages
        .at(-1);

    const liveWorkspace = this.getWorkspaceById(
      conversation.workspaceId
    );

    return {
      id: conversation.id,
      mode: conversation.mode ?? "chat",
      workspaceId:
        conversation.workspaceId ?? null,
      workspaceSnapshot:
        conversation.workspaceSnapshot ?? null,
      modelSelection:
        conversation.modelSelection ?? null,
      modelSnapshot:
        conversation.modelSnapshot ?? null,
      workspaceAvailable:
        conversation.workspaceId
          ? Boolean(liveWorkspace && !liveWorkspace.missing)
          : true,
      title: conversation.title,
      createdAt:
        conversation.createdAt,
      updatedAt:
        conversation.updatedAt,
      messageCount:
        conversation
          .messages
          .length,
      preview:
        lastMessage
          ?.content
          ?.slice(0, 80) ??
        "",
      pinnedMessageCount:
        conversation.messages.filter(
          (message) =>
            message.pinnedToContext
        ).length,
      contextReset:
        Boolean(
          conversation
            .contextStartAfterMessageId
        )
    };
  }
}
