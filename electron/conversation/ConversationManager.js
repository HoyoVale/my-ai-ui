import crypto from "node:crypto";

import {
  applyGoalVerification as applyGoalVerificationRuntime,
  beginGoalRun as beginGoalRuntime,
  completeGoal as completeGoalRuntime,
  finishGoalRun as finishGoalRuntime,
  heartbeatGoal as heartbeatGoalRuntime,
  linkGoalPlatformRun as linkGoalPlatformRunRuntime,
  recordGoalCheckpoint as recordGoalCheckpointRuntime,
  recoverInterruptedGoal,
  transitionGoal as transitionGoalRuntime,
  upsertGoal
} from "../goal/GoalRuntime.js";

import {
  buildShortTermContext
} from "./contextBuilder.js";

import {
  normalizeSessionMode,
  resolveModelBinding
} from "./sessionContext.js";

import {
  createSkillSnapshots
} from "../skills/skillSnapshot.js";

import {
  interruptPlanState
} from "../agent/planState.js";


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
    onChange = () => {},
    completionAuthority = null
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
    this.completionAuthority = completionAuthority;

    this.data = null;
  }

  ensureLoaded() {
    if (!this.data) {
      this.data =
        this.store.load();

      const timestamp = this.now();
      let recovered = false;
      for (const conversation of this.data.conversations) {
        const result = recoverInterruptedGoal(
          conversation.goal,
          { now: timestamp }
        );
        if (result.changed) {
          conversation.goal = result.goal;
          conversation.updatedAt = Math.max(
            conversation.updatedAt,
            timestamp
          );
          recovered = true;
        }
      }
      if (recovered) {
        this.data = this.store.save(this.data);
      }
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
      currentSkillId:
        current?.skillId ?? current?.skillIds?.[0] ?? null,
      currentSkill:
        current?.skillSnapshot ?? current?.skillSnapshots?.[0] ?? null,
      currentSkillIds:
        [...(current?.skillIds ?? (current?.skillId ? [current.skillId] : []))],
      currentSkills:
        clone(current?.skillSnapshots ?? (current?.skillSnapshot ? [current.skillSnapshot] : [])),
      currentSkillRoutingMode:
        current?.skillRoutingMode === "auto" ? "auto" : "manual",

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
    modelSelection = undefined,
    skillId = undefined,
    skillSnapshot = undefined,
    skillIds = undefined,
    skillSnapshots = undefined,
    skillRoutingMode = "manual"
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

    const normalizedSkillIds = [
      ...new Set(
        (Array.isArray(skillIds)
          ? skillIds
          : skillId === undefined
            ? []
            : [skillId])
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      )
    ].slice(0, 4);
    const normalizedSkillSnapshots = createSkillSnapshots(
      Array.isArray(skillSnapshots)
        ? skillSnapshots
        : skillSnapshot
          ? [skillSnapshot]
          : [],
      12
    );
    const normalizedSkillId = normalizedSkillIds[0] ?? null;
    const normalizedSkillSnapshot = normalizedSkillSnapshots.find(
      (snapshot) => snapshot.id === normalizedSkillId
    ) ?? null;

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
      skillId: normalizedSkillId,
      skillSnapshot: normalizedSkillSnapshot,
      skillIds: normalizedSkillIds,
      skillSnapshots: normalizedSkillSnapshots,
      skillRoutingMode: skillRoutingMode === "auto" ? "auto" : "manual",
      goal: null,
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

  setSkillSelection({
    conversationId,
    skill = null,
    skills = undefined,
    skillIds = undefined,
    skillRoutingMode = undefined
  } = {}) {
    const conversation = this.findMutableConversation(
      conversationId || this.ensureLoaded().currentConversationId
    );

    if (!conversation) {
      return { ok: false, code: "conversation-not-found", message: "会话不存在。" };
    }

    const inputSkills = Array.isArray(skills)
      ? skills
      : skill
        ? [skill]
        : [];
    const snapshots = createSkillSnapshots(inputSkills, 12);
    const rootIds = [
      ...new Set(
        (Array.isArray(skillIds) ? skillIds : snapshots.map((snapshot) => snapshot.id))
          .map((value) => String(value ?? "").trim())
          .filter((id) => snapshots.some((snapshot) => snapshot.id === id))
      )
    ].slice(0, 4);

    conversation.skillIds = rootIds;
    conversation.skillSnapshots = snapshots;
    conversation.skillId = rootIds[0] ?? null;
    conversation.skillSnapshot = snapshots.find(
      (snapshot) => snapshot.id === conversation.skillId
    ) ?? null;
    if (skillRoutingMode !== undefined) {
      conversation.skillRoutingMode = skillRoutingMode === "auto" ? "auto" : "manual";
    } else if (!conversation.skillRoutingMode) {
      conversation.skillRoutingMode = "manual";
    }

    conversation.updatedAt = this.now();
    this.commit();

    return { ok: true, conversation: clone(conversation) };
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

  setGoal({
    conversationId,
    objective = "",
    status = "active",
    criteria = [],
    autoContinue = true
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

    const result = upsertGoal(
      conversation.goal,
      {
        objective,
        status,
        criteria,
        autoContinue
      },
      {
        now: this.now(),
        createId: this.createId
      }
    );
    if (!result.ok) return result;

    conversation.goal = result.goal;
    conversation.updatedAt = conversation.goal?.updatedAt ?? this.now();
    this.commit();

    return {
      ok: true,
      conversation: clone(conversation),
      goal: clone(conversation.goal)
    };
  }

  completeGoal({
    conversationId,
    goalId,
    verification = null,
    completionPermit = null
  } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const goal = conversation?.goal;

    if (!conversation || !goal || goal.status !== "active") {
      return { ok: false, code: "goal-not-active" };
    }

    if (goalId && goal.id !== goalId) {
      return { ok: false, code: "goal-changed" };
    }

    if (verification?.verified !== true || verification?.status !== "verified") {
      return { ok: false, code: "goal-verification-required" };
    }

    if (!goal.platformRunId || !this.completionAuthority) {
      return { ok: false, code: "goal-completion-authority-unavailable" };
    }

    const authorization = this.completionAuthority.verify(
      completionPermit,
      {
        goalId: goal.id,
        goalRevision: goal.revision,
        platformRunId: goal.platformRunId
      }
    );
    if (!authorization.ok) return authorization;

    const completed = completeGoalRuntime(
      goal,
      {
        verification,
        completionFingerprint: authorization.fingerprint,
        now: this.now()
      }
    );
    if (!completed.ok) return completed;

    conversation.goal = completed.goal;
    conversation.updatedAt = completed.goal.updatedAt;
    this.commit();

    return {
      ok: true,
      goal: clone(completed.goal)
    };
  }

  linkGoalPlatformRun({ conversationId, goalId, platformRunId } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const goal = conversation?.goal;
    if (!conversation || !goal) return { ok: false, code: "goal-not-found" };
    if (goalId && goal.id !== goalId) return { ok: false, code: "goal-changed" };

    const result = linkGoalPlatformRunRuntime(
      goal,
      { platformRunId, now: this.now() }
    );
    if (!result.ok) return result;
    if (!result.changed) return { ...result, goal: clone(result.goal) };

    conversation.goal = result.goal;
    conversation.updatedAt = result.goal.updatedAt;
    this.commit();
    return { ...result, goal: clone(result.goal) };
  }

  beginGoalRun({
    conversationId,
    goalId,
    runId,
    taskId = null,
    platformRunId = undefined
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => beginGoalRuntime(goal, {
        runId,
        taskId,
        platformRunId,
        now: this.now()
      })
    });
  }

  transitionGoal({
    conversationId,
    goalId,
    phase,
    reason = "",
    runId = null,
    taskId = null,
    waiting = undefined,
    resumable = undefined,
    force = false
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => transitionGoalRuntime(goal, {
        phase,
        reason,
        runId,
        taskId,
        waiting,
        resumable,
        force,
        now: this.now()
      })
    });
  }

  heartbeatGoal({
    conversationId,
    goalId,
    runId = null,
    phase = undefined
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => heartbeatGoalRuntime(goal, {
        runId,
        phase,
        now: this.now()
      })
    });
  }

  recordGoalCheckpoint({
    conversationId,
    goalId,
    checkpoint
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => recordGoalCheckpointRuntime(
        goal,
        checkpoint,
        { now: this.now() }
      )
    });
  }

  finishGoalRun({
    conversationId,
    goalId,
    runId = null,
    outcome = "",
    stopReason = "",
    error = ""
  } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => finishGoalRuntime(goal, {
        runId,
        outcome,
        stopReason,
        error,
        now: this.now()
      })
    });
  }

  mutateGoalRuntime({ conversationId, goalId, mutate } = {}) {
    const conversation = this.findMutableConversation(conversationId);
    const goal = conversation?.goal;
    if (!conversation || !goal) return { ok: false, code: "goal-not-found" };
    if (goalId && goal.id !== goalId) return { ok: false, code: "goal-changed" };
    if (typeof mutate !== "function") {
      return { ok: false, code: "goal-mutation-required" };
    }

    const result = mutate(goal);
    if (!result?.ok) return result;
    if (result.changed === false) {
      return { ...result, goal: clone(result.goal) };
    }

    conversation.goal = result.goal;
    conversation.updatedAt = result.goal.updatedAt;
    this.commit();
    return { ...result, goal: clone(result.goal) };
  }

  recordGoalVerification({ conversationId, goalId, verification } = {}) {
    return this.mutateGoalRuntime({
      conversationId,
      goalId,
      mutate: (goal) => applyGoalVerificationRuntime(
        goal,
        verification,
        { now: this.now() }
      )
    });
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
    planState = null,
    stopReason = "",
    resumedFromMessageId = "",
    taskId = "",
    activity = null,
    skillRun = null
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
        activity,
        skillRun
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
    planState = null,
    stopReason = "",
    resumedFromMessageId = "",
    taskId = "",
    activity = null,
    skillRun = null,
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
        activity,
        skillRun
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
      planState = null,
      stopReason = "",
      resumedFromMessageId = "",
      taskId = "",
      activity = null,
      skillRun = null
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

    if (planState && typeof planState === "object") {
      message.planState = clone(planState);
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

    if (
      skillRun &&
      typeof skillRun === "object"
    ) {
      message.skillRun = clone(skillRun);
    }
  }

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
            plan: clone(message.plan ?? activity.checkpoint?.plan ?? []),
            planState: clone(
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
                      actions: clone(unresolved.actions ?? [])
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
                plan: clone(message.plan ?? event.plan)
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

  getTaskRuntimeRecord(taskId) {
    const normalizedTaskId = String(taskId ?? "").trim();
    if (!normalizedTaskId) {
      return null;
    }

    const data = this.ensureLoaded();
    let latest = null;
    for (const conversation of data.conversations) {
      for (const message of conversation.messages) {
        if (
          message.role !== "assistant" ||
          String(message.taskId ?? "") !== normalizedTaskId
        ) {
          continue;
        }

        const updatedAt = Math.max(
          Number(message.activity?.checkpoint?.updatedAt ?? 0),
          Number(message.activity?.endedAt ?? 0),
          Number(message.createdAt ?? 0)
        );
        if (!latest || updatedAt >= latest.updatedAt) {
          latest = { conversation, message, updatedAt };
        }
      }
    }

    return latest
      ? {
          conversation: clone(latest.conversation),
          message: clone(latest.message)
        }
      : null;
  }

  listToolRuntimeRecoveryHistory() {
    const data = this.ensureLoaded();
    const byTask = new Map();

    for (const conversation of data.conversations) {
      for (const message of conversation.messages) {
        if (message.role !== "assistant" || !message.taskId) {
          continue;
        }

        const recovery =
          message.activity?.checkpoint?.toolRuntime ??
          message.toolRuntime ??
          null;
        if (!recovery || typeof recovery !== "object") {
          continue;
        }

        const calls = Array.isArray(recovery.calls)
          ? recovery.calls
          : [];
        if (calls.length === 0 && !recovery.unresolvedCount) {
          continue;
        }

        const updatedAt = Math.max(
          Number(message.activity?.checkpoint?.updatedAt ?? 0),
          Number(message.activity?.endedAt ?? 0),
          Number(message.createdAt ?? 0)
        );
        const taskId = String(message.taskId);
        const previous = byTask.get(taskId);
        if (previous && previous.updatedAt > updatedAt) {
          continue;
        }

        const checkpoint =
          message.activity?.checkpoint &&
          typeof message.activity.checkpoint === "object"
            ? message.activity.checkpoint
            : null;

        byTask.set(taskId, {
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          mode: checkpoint?.mode === "coding"
            ? "coding"
            : conversation.mode === "coding"
              ? "coding"
              : "chat",
          workspaceId:
            checkpoint?.workspaceId ?? conversation.workspaceId ?? null,
          workspaceName:
            checkpoint?.workspaceSnapshot?.name ??
            conversation.workspaceSnapshot?.name ??
            null,
          messageId: message.id,
          taskId,
          runId: String(message.activity?.runId ?? ""),
          messageStatus: String(message.status ?? ""),
          stopReason: String(message.stopReason ?? ""),
          updatedAt,
          recovery: clone(recovery)
        });
      }
    }

    const items = [...byTask.values()];
    items.sort((left, right) => {
      const unresolvedDifference =
        Number(right.recovery?.unresolvedCount ?? 0) -
        Number(left.recovery?.unresolvedCount ?? 0);
      return unresolvedDifference || right.updatedAt - left.updatedAt;
    });

    return {
      version: 1,
      unresolvedCount: items.reduce(
        (total, item) =>
          total + Number(item.recovery?.unresolvedCount ?? 0),
        0
      ),
      taskCount: items.length,
      items: clone(items)
    };
  }

  updateToolRuntimeRecovery({
    taskId,
    recovery
  } = {}) {
    const normalizedTaskId = String(taskId ?? "").trim();
    if (!normalizedTaskId || !recovery || typeof recovery !== "object") {
      return {
        ok: false,
        code: "invalid-runtime-recovery",
        message: "工具恢复状态无效。"
      };
    }

    const data = this.ensureLoaded();
    let target = null;

    for (const conversation of data.conversations) {
      for (const message of conversation.messages) {
        if (
          message.role !== "assistant" ||
          String(message.taskId ?? "") !== normalizedTaskId
        ) {
          continue;
        }
        const updatedAt = Math.max(
          Number(message.activity?.checkpoint?.updatedAt ?? 0),
          Number(message.activity?.endedAt ?? 0),
          Number(message.createdAt ?? 0)
        );
        if (!target || updatedAt >= target.updatedAt) {
          target = { conversation, message, updatedAt };
        }
      }
    }

    const updatedMessage = target?.message ?? null;
    if (target) {
      const timestamp = this.now();
      updatedMessage.activity = {
        ...(updatedMessage.activity ?? {}),
        checkpoint: {
          ...(updatedMessage.activity?.checkpoint ?? {}),
          toolRuntime: clone(recovery),
          updatedAt: timestamp
        }
      };
      target.conversation.updatedAt = timestamp;
    }

    if (!updatedMessage) {
      return {
        ok: false,
        code: "task-message-not-found",
        message: "找不到该任务对应的会话记录。"
      };
    }

    this.commit();
    return {
      ok: true,
      message: clone(updatedMessage)
    };
  }

  reconcileSettings() {
    const data = this.ensureLoaded();
    const modelSettings = this.getSettings().model;

    for (const conversation of data.conversations) {
      const requestedBinding = resolveModelBinding(
        modelSettings,
        conversation.modelSelection
      );
      const binding = requestedBinding.selection
        ? requestedBinding
        : resolveModelBinding(modelSettings, null);
      conversation.modelSelection = binding.selection;
      conversation.modelSnapshot = binding.snapshot;
    }
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
      skillId:
        conversation.skillId ?? conversation.skillIds?.[0] ?? null,
      skillSnapshot:
        conversation.skillSnapshot ?? conversation.skillSnapshots?.[0] ?? null,
      skillIds:
        [...(conversation.skillIds ?? (conversation.skillId ? [conversation.skillId] : []))],
      skillSnapshots:
        clone(conversation.skillSnapshots ?? (conversation.skillSnapshot ? [conversation.skillSnapshot] : [])),
      skillRoutingMode:
        conversation.skillRoutingMode === "auto" ? "auto" : "manual",
      goal:
        conversation.goal ? clone(conversation.goal) : null,
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
