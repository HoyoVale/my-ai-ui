import crypto from "node:crypto";

import {
  buildShortTermContext
} from "./contextBuilder.js";

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

      totalConversations:
        data.conversations.length
    };
  }

  list() {
    return this
      .ensureLoaded()
      .conversations
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
    title = "新会话"
  } = {}) {
    const data =
      this.ensureLoaded();

    const timestamp =
      this.now();

    const conversation = {
      id: this.createId(),
      title:
        String(title)
          .trim()
          .slice(0, 80) ||
        "新会话",

      summary: "",
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
    status = "complete"
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

    if (!normalizedContent) {
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

  updateSummary(
    conversationId,
    summary
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

    conversation.summary =
      String(summary ?? "")
        .trim()
        .slice(0, 12000);

    conversation.updatedAt =
      this.now();

    this.commit();

    return {
      ok: true,
      conversation:
        this.getConversation(
          conversationId
        )
    };
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

    return {
      id: conversation.id,
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
      hasSummary:
        Boolean(
          conversation.summary
        ),
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
