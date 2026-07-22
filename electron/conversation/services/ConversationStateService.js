import { normalizeSessionMode, resolveModelBinding } from "../sessionContext.js";
import { createSkillSnapshots } from "../../skills/skillSnapshot.js";
import { recoverInterruptedGoal } from "../../goal/GoalRuntime.js";
import { recoverInterruptedExecutionThread } from "../../agent/ExecutionThread.js";
import * as internals from "../ConversationManagerInternals.js";

export const ConversationStateService = {
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
        const threadRecovery = recoverInterruptedExecutionThread(
          conversation.executionThread,
          { now: timestamp }
        );
        if (threadRecovery.changed) {
          conversation.executionThread = threadRecovery.thread;
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
  },

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
  },

  currentWorkspaceId() {
    const data = this.ensureLoaded();
    const current = data.conversations.find(
      (conversation) =>
        conversation.id === data.currentConversationId
    );
  
    return current?.workspaceId ?? null;
  },

  currentMode() {
    const data = this.ensureLoaded();
    const current = data.conversations.find(
      (conversation) =>
        conversation.id === data.currentConversationId
    );
  
    return current?.mode ?? "chat";
  },

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
        internals.clone(current?.skillSnapshots ?? (current?.skillSnapshot ? [current.skillSnapshot] : [])),
      currentSkillRoutingMode:
        current?.skillRoutingMode === "auto" ? "auto" : "manual",
  
      totalConversations:
        data.conversations.length
    };
  },

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
  },

  getConversation(id) {
    const conversation =
      this.ensureLoaded()
        .conversations
        .find(
          (item) =>
            item.id === id
        );
  
    return conversation
      ? internals.clone(conversation)
      : null;
  },

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
  },

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
      executionThread: null,
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
  
    return internals.clone(
      conversation
    );
  },

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
  },

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
        conversation: internals.clone(existing)
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
  },

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
      conversation: internals.clone(conversation)
    };
  },

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
  
    return { ok: true, conversation: internals.clone(conversation) };
  },

  switchWorkspace(workspaceId = null) {
    return this.navigateContext({
      mode: "chat",
      workspaceId
    });
  },

  switchMode(mode) {
    return this.navigateContext({
      mode,
      workspaceId: undefined
    });
  },

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
  },

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
  },

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
  },

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
  },

  findMutableConversation(id) {
    return this
      .ensureLoaded()
      .conversations
      .find(
        (conversation) =>
          conversation.id === id
      ) ?? null;
  },

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
  },

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
  },

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
  },

  commit() {
    this.data =
      this.store.save(
        this.data
      );
  
    this.onChange(
      this.getState()
    );
  },

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
        internals.clone(conversation.skillSnapshots ?? (conversation.skillSnapshot ? [conversation.skillSnapshot] : [])),
      skillRoutingMode:
        conversation.skillRoutingMode === "auto" ? "auto" : "manual",
      goal:
        conversation.goal ? internals.clone(conversation.goal) : null,
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
};
